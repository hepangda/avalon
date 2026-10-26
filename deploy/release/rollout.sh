#!/usr/bin/env bash
# Rolls the Deployment to one digest-pinned image and checks /api/health.
# Any failure after the image changes restores the previous image.
# --restart restarts the pod when that image is already running.
# Usage: rollout.sh <repository@sha256:digest> <version> [--restart]
set -euo pipefail

image=${1:?image}
version=${2:?version}
restart=${3:-}
[[ -z $restart || $restart == --restart ]] || { echo "Unknown option: $restart" >&2; exit 1; }
: "${K8S_NAMESPACE:?}" "${K8S_DEPLOYMENT:?}" "${K8S_CONTAINER:?}" "${PUBLIC_ORIGIN:?}"
[[ $image =~ @sha256:[a-f0-9]{64}$ ]] || { echo "Image must be pinned by digest: $image" >&2; exit 1; }

k() { kubectl -n "$K8S_NAMESPACE" "$@"; }

current_image() {
  k get deployment "$K8S_DEPLOYMENT" --request-timeout=30s \
    -o "jsonpath={.spec.template.spec.containers[?(@.name==\"$K8S_CONTAINER\")].image}"
}

# One strategic merge patch, so the image and the release stamp roll out together.
set_image() {
  local pull_secret=''
  if [[ -n ${K8S_IMAGE_PULL_SECRET:-} ]]; then
    [[ $K8S_IMAGE_PULL_SECRET =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || { echo 'Invalid image pull secret name' >&2; return 1; }
    pull_secret=$(printf ',"imagePullSecrets":[{"name":"%s"}]' "$K8S_IMAGE_PULL_SECRET")
  fi
  k patch deployment "$K8S_DEPLOYMENT" --type strategic --request-timeout=30s -p "$(printf \
    '{"spec":{"template":{"metadata":{"annotations":{"avalon/release":"%s"}},"spec":{"containers":[{"name":"%s","image":"%s"}]%s}}}}' \
    "$2" "$K8S_CONTAINER" "$1" "$pull_secret")"
}

wait_rollout() {
  k rollout status deployment "$K8S_DEPLOYMENT" --timeout=10m
}

healthy() {
  for _ in {1..20}; do
    if curl -fsS --max-time 10 -H "Cache-Control: no-cache" "${PUBLIC_ORIGIN%/}/api/health" | grep -q '"ok":true'; then
      return 0
    fi
    sleep 6
  done
  echo "Health check failed: ${PUBLIC_ORIGIN%/}/api/health" >&2
  return 1
}

previous=$(current_image)
[[ -n $previous ]] || { echo "Container $K8S_CONTAINER not found in $K8S_DEPLOYMENT" >&2; exit 1; }
if [[ $previous == "$image" ]]; then
  if [[ -z $restart ]]; then
    echo "$version is already running"
    exit 0
  fi
  echo "Restarting $version"
  k rollout restart deployment "$K8S_DEPLOYMENT" --request-timeout=30s
  if wait_rollout && healthy; then
    echo "Restarted $version"
    exit 0
  fi
  echo "::error::Restart of $version failed"
  exit 1
fi

echo "Rolling out $version: $previous -> $image"
set_image "$image" "$version"
if wait_rollout && healthy; then
  echo "Released $version"
  exit 0
fi

echo "::error::Release $version failed; restoring $previous"
set_image "$previous" "$version-rollback"
wait_rollout
healthy || echo "::error::Rollback finished but the app is still unhealthy"
exit 1
