#!/usr/bin/env bash
# Use a restricted SSH key to deploy one digest-pinned image to the ARM VM.
set -euo pipefail
image=${1:?image}
version=${2:?version}
restart=${3:-}
[[ $# -le 3 && ( -z $restart || $restart == --restart ) ]] || exit 2
[[ $image =~ ^ghcr.io/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$ ]] || { echo 'Expected a GHCR image digest' >&2; exit 2; }
[[ $version =~ ^sha-[a-f0-9]{40}$ ]] || { echo 'Expected sha-<full commit>' >&2; exit 2; }
: "${VM_HOST:?}" "${VM_USER:?}" "${VM_SSH_KEY_FILE:?}" "${VM_SSH_KNOWN_HOSTS_FILE:?}" "${PUBLIC_ORIGIN:?}"
[[ $VM_HOST =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ && $VM_USER =~ ^[a-z_][a-z0-9_-]*$ ]] || exit 2
[[ $PUBLIC_ORIGIN == https://* ]] || exit 2
ssh -T -i "$VM_SSH_KEY_FILE" -o IdentitiesOnly=yes -o BatchMode=yes \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$VM_SSH_KNOWN_HOSTS_FILE" \
  -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
  "$VM_USER@$VM_HOST" "deploy $image $version${restart:+ $restart}"
for _ in {1..20}; do
  if curl -fsS --max-time 10 -H 'Cache-Control: no-cache' "${PUBLIC_ORIGIN%/}/api/health" |
    python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("ok") is True else 1)'; then
    echo "Released $version; VM and public health checks passed"
    exit 0
  fi
  sleep 3
done
echo '::error::Public health check failed; automatic rollback is disabled' >&2
exit 1
