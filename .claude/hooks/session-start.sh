#!/bin/bash
# Prepare a fresh Claude Code on the web container: install node_modules so
# `npm test` / `npm run build` work on the first try.
set -euo pipefail

# Local machines manage their own node_modules; this is only for cloud sessions.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# Idempotent: a resumed container already has deps, and reinstalling would
# throw away the cached state for no gain.
if [ -d node_modules/vite ] && [ -d node_modules/vitest ]; then
  echo "session-start: node_modules present, skipping install"
  exit 0
fi

# `npm ci`, not `npm install` — install rewrites package-lock.json when the
# container's npm is older than the one that wrote the lock (it drops the
# optional deps' `libc` fields), leaving every session with a dirty tree.
npm ci --no-audit --no-fund
echo "session-start: dependencies installed"
