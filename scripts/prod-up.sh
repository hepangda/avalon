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

compose -f docker-compose.prod.yml up -d --build

port="${APP_PORT:-8001}"
echo "Avalon is starting on port ${port}."
echo "Status: compose -f docker-compose.prod.yml ps"