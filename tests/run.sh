#!/bin/sh
# Starts the Worker on a fresh local database, runs the API tests and the browser flow, then stops it.
# Usage: tests/run.sh <chromium path> [screenshot dir]
cd "$(dirname "$0")/.." || exit 1
# Local stand-in values for the test run; a real .dev.vars of your own is left alone.
[ -f .dev.vars ] || cp tests/local.vars .dev.vars
export WRANGLER_WRITE_LOGS=false
# Stops the local dev server by its process ids: on this macOS listing processes by name can fail (sysmond).
stop() {
  for p in $(ps -axo pid=,command= | grep "wrangler dev --local --port 8799" | grep -v grep | awk '{print $1}') $(lsof -ti tcp:8799 2>/dev/null); do kill "$p" 2>/dev/null; done
  sleep 1
}
fresh() {
  stop; rm -rf .wrangler/state
  npx wrangler d1 migrations apply aiohub --local >/dev/null 2>&1
  # TEST_WHERE: where a request came from is read from made-up test headers, never this machine's real location.
  (npx wrangler dev --local --port 8799 --var TEST_WHERE:1 --var SITE_ORIGIN:http://127.0.0.1:8799 "$@" > /tmp/aiohub-dev.log 2>&1 &)
  for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:8799/api/open && return; sleep 0.5; done
}
npx vite build >/dev/null 2>&1
fresh; node --test tests/api.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)|✖"
fresh; node tests/browser.mjs "$@" 2>&1 | tail -14
# The same site with every person on their own AIOMetadata setup.
# RECS_HOUR: the Recommended rows are worked out only in runs the tests date late in the day, so the other runs stay as they were.
fresh --var FRONT:aiometadata --var FLIXPATROL_API:http://127.0.0.1:8798/flix --var RECS_HOUR:23; node --test tests/aiom.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)|✖" | sed "s/^/aiom: /"
stop
