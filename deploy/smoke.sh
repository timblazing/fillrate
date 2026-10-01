#!/bin/bash
# Container smoke test (spec §14): start the image with a fresh volume, wait for the web app
# and worker, run the bundled synthetic pipeline through the public API, and check that the
# result is validated and exportable; then run an imported CSV scenario behind the operator key
# (smoke_import.py), a GeoJSON import geocoded through Census and the bundled ZIP lookup
# (smoke_geocode.py), the lesson explorer, sweep and replay bundle (smoke_experiments.py), and a run
# over an uploaded directed travel snapshot (smoke_travel.py).
# Usage: deploy/smoke.sh <image> [platform]
set -euo pipefail
image="$1"
platform="${2:-}"
name="fillrate-smoke-$$"
port="${SMOKE_PORT:-3999}"
volume="$name-data"
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
cleanup() { docker logs "$name" 2>&1 | tail -40 || true; docker rm -f "$name" >/dev/null 2>&1 || true; docker volume rm "$volume" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$name" ${platform:+--platform "$platform"} -p "127.0.0.1:$port:3000" \
  -e RUN_KEY=smoke -e SCENARIO_KEY=smoke-scenario -v "$volume:/app/data" "$image" >/dev/null

base="http://127.0.0.1:$port"
for i in $(seq 1 120); do
  if health=$(curl -fsS "$base/api/health" 2>/dev/null) && [ "$(echo "$health" | json 'd["worker"]["connected"]')" = "True" ]; then
    break
  fi
  [ "$i" = 120 ] && { echo "health never reported a connected worker"; exit 1; }
  sleep 2
done
echo "health: $health"

[ "$(docker exec "$name" id -u)" != "0" ] || { echo "container runs as root"; exit 1; }
docker exec "$name" node -e "fetch('http://127.0.0.1:3100/internal/worker/claim',{method:'POST',body:'{}'}).then(r=>process.exit(r.status===401?0:1),()=>process.exit(1))" \
  || { echo "internal transport accepted an unauthenticated request"; exit 1; }

run=$(curl -fsS -X POST "$base/api/v1/runs" -H "x-run-key: smoke" -H "idempotency-key: smoke-$$" -H "content-type: application/json" -d '{}')
id=$(echo "$run" | json 'd["id"]')
echo "run: $id"
for i in $(seq 1 150); do
  status=$(curl -fsS "$base/api/v1/runs/$id" | json 'd["status"]')
  case "$status" in succeeded) break ;; failed|cancelled|interrupted) echo "run ended $status"; exit 1 ;; esac
  [ "$i" = 150 ] && { echo "run did not finish"; exit 1; }
  sleep 2
done
detail=$(curl -fsS "$base/api/v1/runs/$id")
echo "$detail" | json '"validity=%s coverage=%s trucks=%s" % (d["summary"]["validity"], d["summary"]["coverage"], d["summary"]["totals"]["trucks"])'
[ "$(echo "$detail" | json 'd["summary"]["validity"]')" = "valid" ] || { echo "result not validated"; exit 1; }
rows=$(curl -fsS "$base/api/v1/runs/$id/export?format=csv&table=loads" | wc -l)
[ "$rows" -gt 1 ] || { echo "empty loads export"; exit 1; }
curl -fsS "$base/api/v1/runs/$id/export?format=json" | json 'd["summary"]["totals"]["planned_cents"]' >/dev/null
echo "smoke ok: $rows loads CSV rows"
python3 "$(dirname "$0")/smoke_import.py" "$base" smoke-scenario
python3 "$(dirname "$0")/smoke_geocode.py" "$base" smoke-scenario
python3 "$(dirname "$0")/smoke_experiments.py" "$base" smoke "$id"
python3 "$(dirname "$0")/smoke_travel.py" "$base" smoke-scenario

# Explicit deployment modes (spec §14): hosted mode without auth settings refuses to start, and local mode
# serves scenarios and runs with no keys or credentials.
set +e
timeout 180 docker run --rm --name "$name-hosted" ${platform:+--platform "$platform"} -e FILLRATE_MODE=hosted "$image" >/dev/null 2>&1
refused=$?
set -e
docker rm -f "$name-hosted" >/dev/null 2>&1 || true
# 0 means it ran and exited cleanly; 124 means it was still serving when the timeout hit.
if [ "$refused" = 0 ] || [ "$refused" = 124 ]; then echo "hosted mode did not refuse incomplete auth settings (status $refused)"; exit 1; fi
echo "hosted mode refused incomplete auth settings (status $refused)"
local_name="$name-local"; local_port=$((port + 1))
docker run -d --name "$local_name" ${platform:+--platform "$platform"} -p "127.0.0.1:$local_port:3000" -e FILLRATE_MODE=local "$image" >/dev/null
trap 'docker rm -f "$local_name" >/dev/null 2>&1 || true; cleanup' EXIT
for i in $(seq 1 120); do
  curl -fsS "http://127.0.0.1:$local_port/api/health" >/dev/null 2>&1 && break
  [ "$i" = 120 ] && { echo "local mode never became healthy"; exit 1; }
  sleep 2
done
curl -fsS "http://127.0.0.1:$local_port/api/v1/scenarios" >/dev/null || { echo "local mode refused scenarios without a key"; exit 1; }
curl -fsS -X POST "http://127.0.0.1:$local_port/api/v1/runs" -H "idempotency-key: local-$$" -H "content-type: application/json" -d '{}' >/dev/null \
  || { echo "local mode refused a run without a key"; exit 1; }
echo "local mode ok without keys"
