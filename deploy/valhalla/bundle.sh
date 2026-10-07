#!/usr/bin/env bash
# Package built Valhalla tiles for a serving host (docs/valhalla.md, "Prebuilt tiles").
#
#   deploy/valhalla/bundle.sh <built-data-dir> <out-dir>
#       Copies only what deploy/valhalla/compose.serve.yaml needs (the tile archive, valhalla.json,
#       extract-meta.json, file_hashes.txt and default_speeds.json; no extracts or loose tiles) and writes
#       SHA256SUMS. Copy <out-dir> to the host's $VALHALLA_DATA (for example with rsync), check it there
#       with `sha256sum -c SHA256SUMS`, start the service, then run `prepare.sh env -d <dir>` on that host:
#       the graph hash covers the host's effective valhalla.json (its thread count differs from the build).
set -euo pipefail
src="${1:?built data dir}"; out="${2:?output dir}"
files=(valhalla_tiles.tar valhalla.json extract-meta.json file_hashes.txt default_speeds.json)
for f in "${files[@]}"; do [[ -f "$src/$f" ]] || { echo "missing $src/$f; build the tiles first" >&2; exit 1; }; done
mkdir -p "$out"
for f in "${files[@]}"; do cp -p "$src/$f" "$out/$f"; done
sha() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
(cd "$out" && sha "${files[@]}" > SHA256SUMS)
du -sh "$out"
cat "$out/SHA256SUMS"
