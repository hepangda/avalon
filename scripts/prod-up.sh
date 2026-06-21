#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    echo "Docker Compose is not installed. Install docker-compose-plugin or docker-compose." >&2
    exit 1
  fi
}

usage() {
  cat <<'EOF'
Usage: ./scripts/prod-up.sh [--aliyun]

Options:
  --aliyun    Build with Aliyun-friendly mirrors for ECS deployments.
  -h, --help  Show this help message.
EOF
}

DEPLOY_TARGET=default
while [[ $# -gt 0 ]]; do
  case "$1" in
    --aliyun|aliyun)
      DEPLOY_TARGET=aliyun
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ ! -f .env.prod ]]; then
  if command -v openssl >/dev/null 2>&1; then
    password="$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | cut -c1-32)"
  else
    password="$(tr -d '-' < /proc/sys/kernel/random/uuid)"
  fi
  cp .env.prod.example .env.prod
  sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=${password}/" .env.prod
  echo "Created .env.prod with a generated database password."
fi

set -a
. ./.env.prod
set +a

if [[ "$DEPLOY_TARGET" == "aliyun" ]]; then
  export APT_MIRROR="${APT_MIRROR:-mirrors.cloud.aliyuncs.com}"
  export NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
  echo "Using Aliyun deployment mirrors: APT_MIRROR=${APT_MIRROR}, NPM_REGISTRY=${NPM_REGISTRY}"
fi

compose -f docker-compose.prod.yml up -d --build

port="${APP_PORT:-8001}"
echo "Avalon is starting on port ${port}."
echo "Deployment target: ${DEPLOY_TARGET}."
echo "Status: compose -f docker-compose.prod.yml ps"
