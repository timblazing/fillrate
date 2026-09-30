#!/bin/bash
# Starts the web server (which migrates the database before listening), then the optimizer
# service with its worker supervisor. If either process exits, the container exits so the
# restart policy recovers both (spec §14).
set -euo pipefail

export WORKER_TOKEN="${WORKER_TOKEN:-$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')}"

node /app/apps/web/server.js &
web=$!

for _ in $(seq 1 60); do
  if node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"; then
    break
  fi
  kill -0 "$web" 2>/dev/null || exit 1
  sleep 1
done

FILLRATE_WORKER=1 /opt/venv/bin/fillrate-optimizer &
optimizer=$!

trap 'kill -TERM "$web" "$optimizer" 2>/dev/null' TERM INT
set +e
wait -n "$web" "$optimizer"
status=$?
kill -TERM "$web" "$optimizer" 2>/dev/null
wait
exit "$status"
