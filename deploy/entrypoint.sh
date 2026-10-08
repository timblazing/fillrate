#!/bin/bash
# Starts the web server (which migrates the database before listening) and the optimizer service.
# If either process exits, the container exits so the restart policy recovers both.
set -euo pipefail

node /app/apps/web/server.js &
web=$!

/opt/venv/bin/fillrate-optimizer &
optimizer=$!

trap 'kill -TERM "$web" "$optimizer" 2>/dev/null' TERM INT
set +e
wait -n "$web" "$optimizer"
status=$?
kill -TERM "$web" "$optimizer" 2>/dev/null
wait
exit "$status"
