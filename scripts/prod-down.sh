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

ENV_FILE=.env.prod
if [[ ! -f "$ENV_FILE" ]]; then
  ENV_FILE=.env.prod.example
fi

set -a
. "./${ENV_FILE}"
set +a

compose -f docker-compose.prod.yml down

echo "Avalon containers are stopped. Database data is kept in the Docker volume."