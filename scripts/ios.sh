#!/usr/bin/env bash
# The iOS app (IOS.md). Then press Run (▶) in Xcode, with your iPhone selected.
#
#   bun run ios:dev     live reload: Vite on this Mac's LAN address, the app loads the
#                       page from it (and reloads on save). Ctrl+C stops it and puts the
#                       app back on its bundled files.
#   bun run ios:build   bundled: builds with .env.ios (VITE_API_URL = the backend as
#                       the phone reaches it) and copies the files into the app.
#
# Options (environment): LAN_IP=192.168.1.20 to pick the address (default: Wi-Fi's),
# DEV_PORT (5173), API_PORT (8000).
set -euo pipefail
cd "$(dirname "$0")/.."

# Capacitor's CLI needs Node 22+; Bun runs it whatever `node` is
cap() { bun --bun x cap "$@"; }

lan_ip() {
  local ip=${LAN_IP:-}
  [ -n "$ip" ] || ip=$(ipconfig getifaddr en0 2>/dev/null || true)
  [ -n "$ip" ] || ip=$(ipconfig getifaddr en1 2>/dev/null || true)
  if [ -z "$ip" ]; then
    echo "No LAN address found: is the Mac on Wi-Fi? Or set LAN_IP=…" >&2
    exit 1
  fi
  echo "$ip"
}

# The backend must listen on the LAN too (not only 127.0.0.1) and allow this origin
check_backend() {
  local api=$1 origin=$2
  if ! curl -sf -m 3 "$api/api/v1/utils/health-check/" >/dev/null; then
    echo "⚠️  The backend isn't reachable at $api. Start it on all interfaces:" >&2
    echo "    (in ../badminton-backend/backend) uv run fastapi dev --host 0.0.0.0" >&2
    return
  fi
  if ! curl -sf -m 3 -o /dev/null -X OPTIONS \
    -H "Origin: $origin" -H "Access-Control-Request-Method: GET" \
    "$api/api/v1/utils/health-check/"; then
    echo "⚠️  The backend doesn't allow $origin (CORS). See IOS.md, \"Backend\"." >&2
  fi
}

dev() {
  local ip port api_port url api
  ip=$(lan_ip)
  port=${DEV_PORT:-5173}
  api_port=${API_PORT:-8000}
  url="http://$ip:$port"
  api="http://$ip:$api_port"
  check_backend "$api" "$url"

  # `cap copy` needs a build to copy, even though the app won't use it now
  [ -f dist/index.html ] || bun run build

  # The app loads $url instead of its bundled files (capacitor.config.ts server.url)
  CAP_SERVER_URL=$url cap sync ios
  # On exit, back to the bundled files (without this the app would keep looking
  # for the dev server)
  trap 'echo; echo "Putting the app back on its bundled files (run bun run ios:build to update them)…"; cap copy ios >/dev/null' EXIT

  open ios/App/App.xcodeproj
  echo
  echo "▶  In Xcode: pick your iPhone and press Run. The app loads $url"
  echo "   (API: $api). Keep this running; Ctrl+C to stop."
  echo
  VITE_API_URL=$api bunx vite --host 0.0.0.0 --port "$port" --strictPort
}

build() {
  if [ ! -f .env.ios ]; then
    echo "Missing .env.ios. Create it:  cp .env.ios.example .env.ios  and set VITE_API_URL" >&2
    exit 1
  fi
  local api
  api=$(sed -n 's/^VITE_API_URL=//p' .env.ios | tail -1)
  case "$api" in
  "" | *localhost* | *127.0.0.1*)
    echo "VITE_API_URL in .env.ios is \"$api\": on the phone that's the phone itself." >&2
    echo "Use your Mac's LAN address, e.g. http://$(lan_ip):8000" >&2
    exit 1
    ;;
  esac
  check_backend "$api" "capacitor://localhost"

  bunx tsc -p tsconfig.build.json
  bunx vite build --mode ios # .env, then .env.ios on top
  cap sync ios
  echo
  echo "▶  Built for $api. In Xcode (bun run ios:open): pick your iPhone and press Run."
}

case "${1:-}" in
dev) dev ;;
build) build ;;
*)
  echo "Usage: scripts/ios.sh dev|build" >&2
  exit 1
  ;;
esac
