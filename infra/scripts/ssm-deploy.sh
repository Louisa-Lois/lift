#!/usr/bin/env bash
# Rolls one release out to both VMs through SSM Run Command (INF-07). No SSH.
# Run by .github/workflows/deploy.yml after the images are pushed, with credentials for the
# lift-github-deploy role, which may only run AWS-RunShellScript on these two instances:
#
#   CONTROL_INSTANCE_ID=i-… WORKER_INSTANCE_ID=i-… AWS_REGION=eu-west-1 \
#     infra/scripts/ssm-deploy.sh <commit-sha> <image-prefix>
#
# 1. stage   both VMs at once: unpack infra/{compose,traefik,scripts} into /opt/lift/releases/<sha>,
#            check /opt/lift/.env and pull the images. Nothing running changes yet.
# 2. migrate control plane: `api migrate` as a one-off container.
# 3. up      control plane, then the worker.
# The release travels inside the command itself (gzip + base64), so the role needs no S3 access.
# It holds only files from the repo; secrets stay in /opt/lift/.env on each VM.
set -euo pipefail

[ $# -eq 2 ] || { echo "usage: $0 <commit-sha> <image-prefix>" >&2; exit 2; }
sha=$1
prefix=$2
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "not a full commit SHA: $sha" >&2; exit 2; }
[[ $prefix =~ ^ghcr\.io/[a-z0-9._-]+$ ]] || { echo "unexpected image prefix: $prefix" >&2; exit 2; }
: "${CONTROL_INSTANCE_ID:?set CONTROL_INSTANCE_ID}" "${WORKER_INSTANCE_ID:?set WORKER_INSTANCE_ID}"

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

bundle=$(tar -C "$repo_root/infra" -czf - compose traefik scripts | base64 -w0)
if [ "${#bundle}" -gt 48000 ]; then
  echo "::error::the release bundle is ${#bundle} bytes of base64; keep infra/{compose,traefik,scripts} small" >&2
  exit 1
fi
release=/opt/lift/releases/$sha
release_cmd="$release/scripts/lift-release.sh"

# run <instance-id> <label> <script>: runs a POSIX sh script as root on one VM, waits for it,
# prints its output prefixed with the label, and fails if the command did not succeed.
run() {
  local instance=$1 label=$2 script=$3 command_id status deadline
  jq -n --arg script "$script" '{commands: [$script], executionTimeout: ["1500"]}' >"$work/$label.json"
  command_id=$(aws ssm send-command \
    --instance-ids "$instance" \
    --document-name AWS-RunShellScript \
    --comment "lift ${sha:0:7} $label" \
    --timeout-seconds 300 \
    --parameters "file://$work/$label.json" \
    --query Command.CommandId --output text)

  deadline=$((SECONDS + 1800))
  while :; do
    sleep 5
    # Right after send-command the invocation may not exist yet; treat that as pending.
    status=$(aws ssm get-command-invocation --command-id "$command_id" --instance-id "$instance" \
      --query Status --output text 2>/dev/null || echo Pending)
    case $status in
      Pending | InProgress | Delayed) ;;
      *) break ;;
    esac
    if [ "$SECONDS" -ge "$deadline" ]; then
      status=TimedOut
      break
    fi
  done

  # SSM keeps the first 24,000 characters of each stream, which is plenty for these steps.
  aws ssm get-command-invocation --command-id "$command_id" --instance-id "$instance" \
    --output json 2>/dev/null |
    jq -r '[.StandardOutputContent, .StandardErrorContent] | map(select(. != null and . != "")) | .[]' |
    sed "s/^/[$label] /" || true

  if [ "$status" != Success ]; then
    echo "::error::$label failed on $instance: $status (SSM command $command_id)"
    return 1
  fi
}

stage_script() {
  local role=$1
  cat <<EOF
set -eu
umask 022
[ "\$(sed -n 's/^LIFT_ROLE=//p' /opt/lift/host.env)" = "$role" ] || { echo "this VM is not the $role VM" >&2; exit 1; }
rm -rf "$release.unpack"
mkdir -p "$release.unpack"
echo '$bundle' | base64 -d | tar -xz -C "$release.unpack"
rm -rf "$release"
mv "$release.unpack" "$release"
exec "$release_cmd" stage $sha $prefix
EOF
}

echo "::group::stage ${sha:0:7} on both VMs"
run "$CONTROL_INSTANCE_ID" control-stage "$(stage_script control)" &
control_stage=$!
run "$WORKER_INSTANCE_ID" worker-stage "$(stage_script worker)" &
worker_stage=$!
stage_ok=true
wait "$control_stage" || stage_ok=false
wait "$worker_stage" || stage_ok=false
echo "::endgroup::"
$stage_ok || exit 1

echo "::group::migrate (control plane)"
run "$CONTROL_INSTANCE_ID" control-migrate "exec $release_cmd migrate"
echo "::endgroup::"

echo "::group::up (control plane)"
run "$CONTROL_INSTANCE_ID" control-up "exec $release_cmd up"
echo "::endgroup::"

echo "::group::up (worker)"
run "$WORKER_INSTANCE_ID" worker-up "exec $release_cmd up"
echo "::endgroup::"

echo "deployed ${sha:0:7} to both VMs"
