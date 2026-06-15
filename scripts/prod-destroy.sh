#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE=.env.prod
if [[ ! -f "$ENV_FILE" ]]; then
  ENV_FILE=.env.prod.example
fi

read -r -p "This will stop Avalon and delete its database volume and local image. Type DESTROY to continue: " answer
if [[ "$answer" != "DESTROY" ]]; then
  echo "Aborted."
  exit 1
fi

docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml down --volumes --rmi local --remove-orphans

echo "Avalon containers, network, database volume, and locally built image were removed."