#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

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

docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build

port="$(grep -E '^APP_PORT=' .env.prod | cut -d= -f2 || true)"
echo "Avalon is starting on port ${port:-8001}."
echo "Status: docker compose --env-file .env.prod -f docker-compose.prod.yml ps"