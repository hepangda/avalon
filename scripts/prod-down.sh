#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE=.env.prod
if [[ ! -f "$ENV_FILE" ]]; then
  ENV_FILE=.env.prod.example
fi

docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml down

echo "Avalon containers are stopped. Database data is kept in the Docker volume."