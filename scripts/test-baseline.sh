#!/bin/sh
set -eu

repository=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repository"
# Use the repository Node/pnpm versions. Never read .env or target the normal lab:
# database tests truncate their synthetic baseline and require a disposable cluster.
pnpm lint
pnpm test
pnpm typecheck
pnpm test:e2e:typecheck
pnpm build
pnpm test:integration
