# Hostinger deployment record for `698fbd8`

This is the owner-requested tested runtime update while M8 acceptance issues #88–#90 remain open. Source: `698fbd8d96abb8f174aa766566a2c0a91762ec58`. Publication: [image workflow 37680183468](https://github.com/timblazing/fillrate/actions/runs/37680183468), successful for CI/npm and native amd64/arm64 build, smoke and benchmark jobs. Release tag: `ghcr.io/timblazing/fillrate:sha-698fbd8`; verified multi-architecture index digest: `sha256:c76155c1b57e4a65b544b636a2c18020d74626567a882039efb96b79d6861114`. The amd64 manifest is `sha256:25d580096a5ca78d6d06dbbce68d9fe916ff59fcf79eb4f344799e4ebdbfc71e`; the arm64 manifest is `sha256:0354602c409f83b7f63770edfc7c873caa538415a2ab6a7662d5023594a6d1fb`.

VPS inspection on 2026-10-07 found `hostinger`, `~/containers/fillrate`, service/container `fillrate`, a healthy app and an active `fillrate-backup.timer`. The live image before the upgrade was source `b296645`, digest `sha256:607f0b45b6d3c96d291bb37ddaafee90fb764c9853b5c0c0c1c7730b0d2df3ff`. Compose uses only `compose.yaml`; it contains the live Valhalla configuration.

## Backup, pin and upgrade

These are the guarded commands used for this deployment. The running server now uses the new digest; the baseline check will stop a replay. They update only Fillrate in the existing Compose file and recreate only that service. The rollback section restores the protected pre-upgrade Compose file.

```bash
ssh hostinger
cd ~/containers/fillrate
set -euo pipefail
umask 077

release_image='ghcr.io/timblazing/fillrate@sha256:c76155c1b57e4a65b544b636a2c18020d74626567a882039efb96b79d6861114'
previous_image='ghcr.io/timblazing/fillrate@sha256:607f0b45b6d3c96d291bb37ddaafee90fb764c9853b5c0c0c1c7730b0d2df3ff'
docker image inspect "$(docker inspect fillrate --format '{{.Image}}')" --format '{{json .RepoDigests}}' | python3 -c 'import json,sys; assert sys.argv[1] in json.load(sys.stdin), "Live baseline changed; refresh the rollback reference"' "$previous_image"
upgrade_dir="$(pwd)/backups/upgrade-698fbd8-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 "$upgrade_dir"
cp -p compose.yaml "$upgrade_dir/compose.before.yaml"
if [ -f .env ]; then cp -p .env "$upgrade_dir/env.before"; fi
printf '%s\n' "$previous_image" > "$upgrade_dir/previous-image.txt"
./backup.sh fillrate "$upgrade_dir"
(cd "$upgrade_dir" && sha256sum -c fillrate-*.sqlite.sha256)
printf 'Retain upgrade backup directory: %s\n' "$upgrade_dir"

pin_fillrate_image() {
  python3 - "$1" <<'PY'
import os, pathlib, re, stat, sys
image = sys.argv[1]
if not re.fullmatch(r"ghcr\.io/timblazing/fillrate@sha256:[0-9a-f]{64}", image):
    raise SystemExit("Expected a verified Fillrate digest")
path = pathlib.Path("compose.yaml")
lines = path.read_text().splitlines(keepends=True)
inside = False
matches = []
for index, line in enumerate(lines):
    service = re.match(r"^  ([A-Za-z0-9_-]+):\s*(?:#.*)?$", line.rstrip("\n"))
    if service:
        inside = service.group(1) == "fillrate"
    if inside and re.match(r"^    image:\s*", line):
        matches.append(index)
if len(matches) != 1:
    raise SystemExit("Expected exactly one services.fillrate.image; inspect Compose locally")
lines[matches[0]] = f"    image: {image}\n"
temp = path.with_name("compose.yaml.upgrade-tmp")
temp.write_text("".join(lines))
os.chmod(temp, stat.S_IMODE(path.stat().st_mode))
os.replace(temp, path)
PY
}

docker pull "$release_image"
pin_fillrate_image "$release_image"
docker compose config --quiet
docker compose up -d --no-deps fillrate

healthy=0
for attempt in $(seq 1 60); do
  if [ "$(docker inspect fillrate --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}')" = healthy ]; then
    healthy=1
    break
  fi
  sleep 2
done
test "$healthy" = 1
test "$(docker inspect fillrate --format '{{.Config.Image}}')" = "$release_image"
docker exec fillrate node -e '
fetch("http://127.0.0.1:3000/api/health").then(async r=>{const h=await r.json();
if(h.status!=="ok"||h.database!=="ok"||!h.worker.connected||h.road.valhalla.graph_config_hash!=="sha256:208e3e70ea06dfa730910332081b2cff0b6cc2aa3758441ce335c09f4bbe338d") process.exit(2);
console.log("database, worker and unchanged Valhalla identity: ok")})'
systemctl --user is-active fillrate-backup.timer
docker exec fillrate /opt/venv/bin/python -c '
import os,sqlite3
db=sqlite3.connect("file:"+os.environ.get("DATA_DIR","/app/data")+"/fillrate.sqlite?mode=ro",uri=True)
assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
assert db.execute("SELECT count(*) FROM __drizzle_migrations").fetchone()[0] == 12
print("SQLite integrity and 12 migrations: ok")'
curl -fsS https://fillrate.blasingame.dev/api/health
curl -fsS https://fillrate.blasingame.dev/api/v1/me | python3 -c '
import json,sys
m=json.load(sys.stdin)
assert m["mode"] == "hosted" and m["signup_mode"] == "request"
assert m["user"] is None and not m["admin"]
print("anonymous hosted/request policy: ok")'
test "$(curl -sS -o /dev/null -w '%{http_code}' https://fillrate.blasingame.dev/api/v1/admin/access-requests)" = 404
```

The existing hosted/request OAuth settings, data mount, proxy configuration and road-provider identity stay in the existing Compose/environment files. Do not post those files or account data in the public issue. The private backup directory contains configuration and database data.

## Signed-in acceptance and evidence

Sign in as the approved owner and complete one synthetic import → save → run → inspect shipment/unshipped reasons → export. Check anonymous and pending access behavior against the existing policy. For [#92](https://github.com/timblazing/fillrate/issues/92), use a few synthetic OK/TX/KS stops, build a Valhalla matrix, run on it, and open shipment road geometry. Stops outside OK/TX/NM/CO/KS/MO/AR remain outside hosted road coverage.

Record the deployed digest, timestamp, backup checksum/integrity result, container/worker health, backup-timer result, access-policy checks and workflow result in [#91](https://github.com/timblazing/fillrate/issues/91). Record the road UI result in #92. These results can then be retained in `docs/release-verification.md`. Publication does not close deployment or the remaining frontend acceptance.

## Image rollback

There are no database migration or schema changes between live source `b296645` and `698fbd8`. For an application-only regression, retain the current database and return to the pre-upgrade Compose file. Set `upgrade_dir` to `/home/clay/containers/fillrate/backups/upgrade-698fbd8-20261007T203618Z`:

```bash
upgrade_dir="$HOME/containers/fillrate/backups/upgrade-698fbd8-20261007T203618Z"
cp -p "$upgrade_dir/compose.before.yaml" compose.yaml
docker compose config --quiet
docker compose up -d --no-deps fillrate
test "$(docker inspect fillrate --format '{{.Config.Image}}')" = ghcr.io/timblazing/fillrate:latest
```

Repeat the health/worker and access checks. If the database itself needs restoration, stop Fillrate and follow the [documented restore procedure](../hosted-operations.md#configure-a-hosted-deployment-owner) using the private pre-upgrade backup, restoring data together with a compatible image. A data restore discards writes made after that backup; retain the backup and checksum for review.
