#!/usr/bin/env bash
# Runs one Lift release on a VM, as root. Each deploy unpacks infra/compose, infra/traefik and
# infra/scripts into /opt/lift/releases/<sha>; this script works on the release it lives in.
#
#   lift-release.sh stage <sha> <image-prefix>   write release.env, check /opt/lift/.env, pull images
#   lift-release.sh migrate                      control plane only: `api migrate` as a one-off container
#   lift-release.sh up                           start this release and make it /opt/lift/current
#   lift-release.sh boot                         start the current release without pulling (lift.service)
#   lift-release.sh compose <args…>              any docker compose command with the right files,
#                                                e.g. `compose ps` or `compose logs -f api`
#
# Called through SSM Run Command by infra/scripts/ssm-deploy.sh (.github/workflows/deploy.yml) and
# at boot by lift.service (infra/terraform/cloud-init.yaml.tftpl). It never prints secret values.
set -euo pipefail

LIFT_DIR=${LIFT_DIR:-/opt/lift}
RELEASE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
HOST_ENV=$LIFT_DIR/host.env
SECRETS_ENV=$LIFT_DIR/.env
RELEASE_ENV=$RELEASE_DIR/release.env
CONFIG_DIR=$LIFT_DIR/config
KEEP_RELEASES=5
# SSM and systemd run without HOME; keep registry credentials in one known place.
export DOCKER_CONFIG=${DOCKER_CONFIG:-/root/.docker}

log() { printf '[lift-release] %s\n' "$*"; }
die() { printf '[lift-release] error: %s\n' "$*" >&2; exit 1; }

# The value of KEY in an env file, read as text: the file is never sourced or evaluated.
env_value() { [ -f "$1" ] && sed -n "s/^$2=//p" "$1" | tail -n 1 || true; }

[ -f "$HOST_ENV" ] || die "$HOST_ENV is missing; cloud-init writes it at first boot"
ROLE=$(env_value "$HOST_ENV" LIFT_ROLE)
case "$ROLE" in
  control | worker) ;;
  *) die "LIFT_ROLE in $HOST_ENV must be control or worker" ;;
esac

compose() {
  docker compose \
    --project-name lift \
    --project-directory "$RELEASE_DIR/compose" \
    --file "$RELEASE_DIR/compose/$ROLE.yml" \
    --env-file "$HOST_ENV" \
    --env-file "$SECRETS_ENV" \
    --env-file "$RELEASE_ENV" \
    "$@"
}

require_release_env() {
  [ -f "$RELEASE_ENV" ] || die "$RELEASE_ENV is missing; run stage first"
}

# Fails, naming the first empty variable, when /opt/lift/.env lacks something the compose file
# needs. Compose's message names the variable, never a value.
check_secrets() {
  [ -f "$SECRETS_ENV" ] || die "$SECRETS_ENV is missing; fill it in from infra/compose/$ROLE.env.example"
  chown root:root "$SECRETS_ENV"
  chmod 600 "$SECRETS_ENV"
  compose config --quiet || die "complete $SECRETS_ENV (keys: infra/compose/$ROLE.env.example)"
}

registry_login() {
  local user token
  user=$(env_value "$SECRETS_ENV" GHCR_PULL_USER)
  token=$(env_value "$SECRETS_ENV" GHCR_PULL_TOKEN)
  [ -n "$token" ] || return 0
  [ -n "$user" ] || die "GHCR_PULL_TOKEN is set but GHCR_PULL_USER is empty"
  printf '%s' "$token" | docker login ghcr.io --username "$user" --password-stdin >/dev/null
}

# Only the static file matters: Traefik must restart to read it, while files under dynamic/ reload
# by themselves.
traefik_config_sha() {
  sha256sum "$RELEASE_DIR/traefik/$ROLE/traefik.yml" | cut -c1-12
}

# Copies this release's Traefik config to the stable path the containers mount. rsync replaces
# files inside the directory, so a running Traefik sees new dynamic files without a restart.
install_config() {
  install -d -m 0755 "$CONFIG_DIR/traefik"
  rsync -a --delete "$RELEASE_DIR/traefik/" "$CONFIG_DIR/traefik/"
}

ensure_networks() {
  if [ "$ROLE" = worker ] && ! docker network inspect lift-edge >/dev/null 2>&1; then
    docker network create lift-edge >/dev/null
    log "created network lift-edge"
  fi
}

# The worker's container firewall (INF-11). Each release installs its unit, because cloud-init
# never runs again on existing VMs; at boot the unit applies it before Docker starts.
install_firewall() {
  [ "$ROLE" = worker ] || return 0
  local unit=/etc/systemd/system/lift-firewall.service
  if ! cmp -s "$RELEASE_DIR/scripts/lift-firewall.service" "$unit"; then
    install -m 0644 "$RELEASE_DIR/scripts/lift-firewall.service" "$unit"
    systemctl daemon-reload
  fi
  systemctl enable --quiet lift-firewall.service
  apply_firewall
}

# Applying it again is harmless: LIFT-FW is replaced in one transaction.
apply_firewall() {
  [ "$ROLE" = worker ] || return 0
  "$RELEASE_DIR/scripts/firewall.sh"
}

activate() {
  ln -sfn "$RELEASE_DIR" "$LIFT_DIR/current.next"
  mv -Tf "$LIFT_DIR/current.next" "$LIFT_DIR/current"
}

# Keeps the newest release directories and the platform images they use. Users' app images on the
# worker (lift/{serviceId}:…) are not touched here; the worker's cleanup job owns those (INF-14).
prune() {
  local current prefix kept ref
  current=$(readlink -f "$LIFT_DIR/current")
  find "$LIFT_DIR/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' |
    sort -rn | tail -n +$((KEEP_RELEASES + 1)) | cut -d' ' -f2- |
    while read -r dir; do
      [ "$dir" = "$current" ] || rm -rf -- "$dir"
    done

  prefix=$(env_value "$RELEASE_ENV" LIFT_IMAGE_PREFIX)
  kept=$(find "$LIFT_DIR/releases" -mindepth 1 -maxdepth 1 -type d -printf '%f\n')
  docker image ls --format '{{.Repository}}:{{.Tag}}' --filter "reference=$prefix/lift-*" |
    while read -r ref; do
      grep -qxF "${ref##*:}" <<<"$kept" || docker image rm "$ref" >/dev/null 2>&1 || true
    done
}

cmd_stage() {
  local sha=$1 prefix=$2
  [[ $sha =~ ^[0-9a-f]{40}$ ]] || die "stage: expected a full 40-character commit SHA"
  [[ $prefix =~ ^ghcr\.io/[a-z0-9._-]+$ ]] || die "stage: expected an image prefix like ghcr.io/owner"
  [ "$(basename "$RELEASE_DIR")" = "$sha" ] || die "stage: this release is unpacked in the wrong directory"

  cat >"$RELEASE_ENV" <<EOF
# Written by lift-release.sh stage. Not secret.
IMAGE_TAG=$sha
LIFT_IMAGE_PREFIX=$prefix
LIFT_CONFIG_DIR=$CONFIG_DIR
TRAEFIK_CONFIG_SHA=$(traefik_config_sha)
EOF
  check_secrets
  registry_login
  log "$ROLE: pulling images for ${sha:0:7}"
  compose pull --quiet
  log "$ROLE: staged ${sha:0:7}"
}

cmd_migrate() {
  [ "$ROLE" = control ] || die "migrate runs on the control plane only"
  require_release_env
  check_secrets
  log "control: running database migrations"
  # Starts Postgres and Redis first if needed (api depends on both being healthy).
  compose run --rm --no-TTY --quiet-pull api migrate
}

cmd_up() {
  require_release_env
  check_secrets
  install_config
  ensure_networks
  log "$ROLE: starting $(env_value "$RELEASE_ENV" IMAGE_TAG | cut -c1-7)"
  # --wait fails the deploy if a container exits or stays unhealthy.
  compose up --detach --remove-orphans --wait --wait-timeout 300
  # After compose up: the worker container is recreated with its route through lift-system first.
  install_firewall
  activate
  prune
  compose ps --format 'table {{.Service}}\t{{.Status}}'
  log "$ROLE: up"
}

cmd_boot() {
  require_release_env
  install_config
  ensure_networks
  # lift-firewall.service applied it before Docker started; again here in case Docker reset it.
  apply_firewall
  compose up --detach --remove-orphans
}

case "${1:-}" in
  stage)
    [ $# -eq 3 ] || die "usage: lift-release.sh stage <sha> <image-prefix>"
    cmd_stage "$2" "$3"
    ;;
  migrate) cmd_migrate ;;
  up) cmd_up ;;
  boot) cmd_boot ;;
  compose)
    shift
    require_release_env
    compose "$@"
    ;;
  *) die "usage: lift-release.sh stage <sha> <image-prefix> | migrate | up | boot | compose <args…>" ;;
esac
