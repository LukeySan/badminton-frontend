#!/usr/bin/env bash
# WebKit (Safari's engine) tests on a Mac (desktop Safari + iPhone projects), in Linux WebKit inside Docker, like CI.
# Playwright's own macOS WebKit hangs opening pages on macOS 26.0 (Nov 2026).
# Needs: the backend on :8000 (and Mailpit on :8025), Docker running.
#   bun run test:webkit                       # whole suite
#   bun run test:webkit tests/videos.spec.ts  # extra args go to `playwright test`
set -euo pipefail
cd "$(dirname "$0")/.."

PW_VERSION=$(node -p 'require("@playwright/test/package.json").version')
PREVIEW_PORT=5174

# Test the production build (what users get): the dev server's on-demand module
# loading made WebKit runs slow and flaky through Docker's network.
bun run build
bunx vite preview --host 127.0.0.1 --port "$PREVIEW_PORT" --strictPort >/dev/null 2>&1 &
PREVIEW_PID=$!
trap 'kill $PREVIEW_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do
  curl -sf "http://127.0.0.1:$PREVIEW_PORT/" >/dev/null && break
  sleep 0.5
done

docker run --rm --ipc=host \
  -v "$PWD:/app" -w /app \
  -e PLAYWRIGHT_BASE_URL=http://localhost:5173 -e PW_WEBKIT=1 \
  "mcr.microsoft.com/playwright:v$PW_VERSION-noble" \
  sh -c 'node scripts/docker-forward.cjs & sleep 1;
         node node_modules/@playwright/test/cli.js test --project=webkit --project=iphone \
           --output=/tmp/pw-results "$@"' -- "$@"
