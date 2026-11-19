#!/usr/bin/env bash
# INF-11's acceptance test, run as root on the worker VM:
#   sudo /opt/lift/current/scripts/firewall-check.sh
# It tries each path from where it matters: throwaway curl containers on lift-edge (where apps
# run) and lift-build (where BuildKit runs build steps) must not reach the metadata endpoint or
# the control plane, and must reach GitHub; the worker container must reach the API and Redis,
# through lift-system. It changes nothing and prints no secret. Exit status: the failure count.
set -uo pipefail

HOST_ENV=${HOST_ENV:-/opt/lift/host.env}
control_ip=$(sed -n 's/^CONTROL_PRIVATE_IP=//p' "$HOST_ENV" | tail -n 1)
# The probe's curl image is already on the VM, pinned by digest.
image=$(docker inspect -f '{{.Config.Image}}' lift-probe 2>/dev/null)
failures=0

ok() { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; failures=$((failures + 1)); }

# Whether a fresh container on network $1 gets a TCP connection to URL $2 (whatever is said next).
connects() {
  local seconds
  seconds=$(docker run --rm --network "$1" --entrypoint curl "$image" -s -o /dev/null \
    -w '%{time_connect}' --connect-timeout 3 --max-time 5 "$2" 2>/dev/null)
  [ -n "$seconds" ] && [ "$seconds" != "0.000000" ]
}

expect_blocked() { if connects "$1" "$3"; then bad "$2"; else ok "$2"; fi; }
expect_open() { if connects "$1" "$3"; then ok "$2"; else bad "$2"; fi; }

echo "== LIFT-FW"
iptables -S LIFT-FW 2>/dev/null || bad "LIFT-FW exists"
if [ "$(iptables -S DOCKER-USER | sed -n 2p)" = "-A DOCKER-USER -j LIFT-FW" ]; then
  ok "DOCKER-USER jumps to LIFT-FW first"
else
  bad "DOCKER-USER jumps to LIFT-FW first"
fi
if iptables -S LIFT-FW | grep -q -- '--dport 25 -j DROP'; then ok "outbound mail (TCP 25) dropped"; else bad "outbound mail (TCP 25) dropped"; fi
if systemctl is-enabled --quiet lift-firewall.service; then ok "lift-firewall.service enabled"; else bad "lift-firewall.service enabled"; fi

if [ -z "$image" ] || [ -z "$control_ip" ]; then
  bad "lift-probe's image and CONTROL_PRIVATE_IP are needed for the path checks"
  exit "$failures"
fi

for network in lift-edge lift-build; do
  echo "== from a container on $network"
  expect_blocked "$network" "metadata endpoint blocked" "http://169.254.169.254/latest/meta-data/"
  expect_blocked "$network" "control plane API (:4000) blocked" "http://$control_ip:4000/api/v1/health"
  expect_blocked "$network" "control plane Redis (:6379) blocked" "http://$control_ip:6379/"
  expect_open "$network" "github.com reachable" "https://github.com/"
done

echo "== from the worker"
gateway=$(docker exec lift-worker-1 awk '$2 == "00000000" { print $3 }' /proc/net/route 2>/dev/null)
# 172.30.0.1, lift-system's gateway, as /proc/net/route spells it (little-endian hex).
if [ "$gateway" = "01001EAC" ]; then ok "default route through lift-system"; else bad "default route through lift-system (gateway $gateway)"; fi
if docker exec lift-worker-1 node -e "fetch('http://$control_ip:4000/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"; then
  ok "API health answers"
else
  bad "API health answers"
fi
if docker exec lift-worker-1 node -e "const s = require('node:net').connect(6379, '$control_ip'); s.on('connect', () => process.exit(0)); s.on('error', () => process.exit(1)); setTimeout(() => process.exit(1), 3000)"; then
  ok "Redis reachable"
else
  bad "Redis reachable"
fi

echo "== $failures failure(s)"
exit "$failures"
