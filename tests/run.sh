#!/bin/sh
# Starts the Worker on a fresh local database, runs the API tests and the browser flow, then stops it.
# Usage: tests/run.sh <chromium path> [screenshot dir]
cd "$(dirname "$0")/.." || exit 1
# Local stand-in values for the test run; a real .dev.vars of your own is left alone.
[ -f .dev.vars ] || cp tests/local.vars .dev.vars
export WRANGLER_WRITE_LOGS=false
fresh() {
  pkill -f "wrangler dev --local --port 8799"; sleep 1; rm -rf .wrangler/state
  npx wrangler d1 migrations apply aiohub --local >/dev/null 2>&1
  (npx wrangler dev --local --port 8799 > /tmp/aiohub-dev.log 2>&1 &)
  for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:8799/api/open && return; sleep 0.5; done
}
npx vite build >/dev/null 2>&1
fresh; node --test tests/api.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)|✖"
fresh; node tests/browser.mjs "$@" 2>&1 | tail -14
pkill -f "wrangler dev --local --port 8799"
