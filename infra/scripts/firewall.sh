#!/usr/bin/env bash
# The worker's firewall for containers (INF-11; docs/prd/04-infrastructure.md, "Hardening
# checklist"). Everything a container sends off the VM passes through FORWARD, whose first jump is
# Docker's DOCKER-USER chain; this script hangs one chain of its own, LIFT-FW, from it:
#
#   1. replies to connections already allowed pass;
#   2. nothing reaches the instance metadata endpoint (IMDSv2's hop limit 1 already stops tokens);
#   3. lift-system (172.30.0.0/24, the worker's own network) may reach the control plane's
#      private IP on 4000 (internal API) and 6379 (Redis);
#   4. nothing else reaches the control plane: not apps, not builds (BuildKit), not the probe;
#   5. no outbound mail (TCP 25) from any container.
#
# Safe to run again: the chain is replaced in one iptables-restore transaction and the jump is
# added once. lift-firewall.service runs it before Docker starts, so no container ever runs
# without it; lift-release.sh runs it again after each release and boot.
#
# In an emergency, `iptables -D DOCKER-USER -j LIFT-FW` lifts it until the next boot or release.
set -euo pipefail

HOST_ENV=${HOST_ENV:-/opt/lift/host.env}
SYSTEM_SUBNET=172.30.0.0/24

die() { printf '[lift-firewall] error: %s\n' "$*" >&2; exit 1; }
env_value() { sed -n "s/^$1=//p" "$HOST_ENV" | tail -n 1; }

[ -f "$HOST_ENV" ] || die "$HOST_ENV is missing"
[ "$(env_value LIFT_ROLE)" = worker ] || die "the container firewall belongs on the worker VM only"
control_ip=$(env_value CONTROL_PRIVATE_IP)
[[ $control_ip =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || die "CONTROL_PRIVATE_IP in $HOST_ENV isn't an IPv4 address"

# Mail is dropped where it leaves the VM; without a default route yet, everywhere.
egress=$(ip -o route show default 2>/dev/null | awk '{print $5; exit}')
mail_rule="-p tcp --dport 25 -j DROP"
[ -n "$egress" ] && mail_rule="-o $egress $mail_rule"

# Docker creates DOCKER-USER when it starts and leaves its rules alone; creating it here first
# lets this run before Docker does.
iptables -w -N DOCKER-USER 2>/dev/null || true

iptables-restore -w --noflush <<EOF
*filter
:LIFT-FW - [0:0]
-A LIFT-FW -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
-A LIFT-FW -d 169.254.169.254/32 -j DROP
-A LIFT-FW -s $SYSTEM_SUBNET -d $control_ip/32 -p tcp -m multiport --dports 4000,6379 -j RETURN
-A LIFT-FW -d $control_ip/32 -j DROP
-A LIFT-FW $mail_rule
COMMIT
EOF

iptables -w -C DOCKER-USER -j LIFT-FW 2>/dev/null || iptables -w -I DOCKER-USER 1 -j LIFT-FW
printf '[lift-firewall] LIFT-FW applied (control plane %s, egress %s)\n' "$control_ip" "${egress:-unknown}"
