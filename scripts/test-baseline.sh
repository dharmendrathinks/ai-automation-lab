#!/bin/sh
set -eu

repository=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
modules_volume=$(docker volume create)
trap 'docker volume rm "$modules_volume" >/dev/null 2>&1 || true' EXIT HUP INT TERM

docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  --env-file "$repository/.env" \
  --volume "$repository:/workspace" \
  --volume "$modules_volume:/workspace/node_modules" \
  --workdir /workspace \
  node:24.21.0-bookworm@sha256:6dac556d980b7f0e5498d08f08cee0ca67798b4ad6c23964a9214920e67758d0 \
  bash -lc 'corepack pnpm install --frozen-lockfile --store-dir=/tmp/pnpm-store && corepack pnpm test && corepack pnpm typecheck && corepack pnpm build && TEST_DATABASE_URL="postgresql://relaydesk:${RELAYDESK_DB_PASSWORD}@host.docker.internal:55432/relaydesk" corepack pnpm exec vitest run --config vitest.integration.config.ts'
