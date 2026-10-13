#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
image="${1:?Pass the immutable image tag}"
[[ "$image" =~ ^ghcr.io/[a-zA-Z0-9_./-]+:[a-f0-9]{40}$ ]] || { echo "Invalid image"; exit 1; }
previous="$(cat current-image 2>/dev/null || true)"
export AURORA_IMAGE="$image"
docker compose -f compose.yml pull
mkdir -p backups
if [[ -n "$previous" ]]; then
  docker compose -f compose.yml exec -T app node --input-type=module -e 'import{DatabaseSync,backup}from"node:sqlite";const db=new DatabaseSync("/app/data/aurora.sqlite");await backup(db,"/app/data/pre-release.sqlite");db.close();'
  docker compose -f compose.yml cp app:/app/data/pre-release.sqlite "backups/$(date -u +%Y%m%dT%H%M%SZ).sqlite"
fi
if docker compose -f compose.yml up -d --wait --wait-timeout 90; then
  printf '%s\n' "$previous" > previous-image
  printf '%s\n' "$image" > current-image
  echo "Release healthy"
else
  echo "Release failed; restoring previous application image"
  if [[ -n "$previous" ]]; then export AURORA_IMAGE="$previous"; docker compose -f compose.yml up -d --wait; fi
  exit 1
fi
