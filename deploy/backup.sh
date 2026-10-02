#!/bin/bash
# Consistent SQLite backup of a running Fillrate container (spec §14). Uses SQLite's online backup API
# through the image's Python (safe while WAL is active and the app is serving), checks the copy's
# integrity, copies it to the host with a SHA-256 next to it, and deletes host backups older than the
# retention window (the /privacy promise: at most 30 days).
# Usage: deploy/backup.sh [container] [dest-dir]   (defaults: fillrate, ./backups)
# Env: BACKUP_RETENTION_DAYS (default 30)
set -euo pipefail
umask 077  # backups may contain hosted customer data; host copies and their directory are private
container="${1:-fillrate}"
dest="${2:-./backups}"
days="${BACKUP_RETENTION_DAYS:-30}"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
name="fillrate-$stamp.sqlite"
mkdir -p "$dest"
chmod 700 "$dest"

docker exec -i "$container" /opt/venv/bin/python - "$name" <<'PY'
import os, sqlite3, sys
data = os.environ.get("DATA_DIR", "/app/data")
os.makedirs(f"{data}/backups", exist_ok=True)
target = f"{data}/backups/{sys.argv[1]}"
src = sqlite3.connect(f"file:{data}/fillrate.sqlite?mode=ro", uri=True, timeout=30)
dst = sqlite3.connect(target)
src.backup(dst)
src.close()
check = dst.execute("PRAGMA integrity_check").fetchone()[0]
migrations = dst.execute("SELECT count(*) FROM __drizzle_migrations").fetchone()[0]
dst.close()
if check != "ok":
    os.remove(target)
    sys.exit(f"integrity_check failed: {check}")
print(f"backup ok: integrity ok, {migrations} migrations applied")
PY

docker cp "$container:/app/data/backups/$name" "$dest/$name"
docker exec "$container" rm -f "/app/data/backups/$name"
(cd "$dest" && sha256sum "$name" > "$name.sha256" && cat "$name.sha256")
chmod 600 "$dest/$name" "$dest/$name.sha256"
find "$dest" -maxdepth 1 -name 'fillrate-*.sqlite*' -mtime "+$days" -print -delete
