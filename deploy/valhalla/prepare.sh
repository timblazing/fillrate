#!/usr/bin/env bash
# Prepare the optional Valhalla road service (spec §7, §14; docs/valhalla.md).
#
#   deploy/valhalla/prepare.sh [-d DIR] <geofabrik-region-path>...
#       Downloads the OSM extracts (for example north-america/us/tennessee), checks Geofabrik's
#       MD5, writes extract-meta.json (source URLs, extract dates, checksums, pinned image) and
#       valhalla.json (service limits) into DIR. Tiles are built by the container on first start.
#   deploy/valhalla/prepare.sh env [-d DIR]
#       After the tiles are built, prints the VALHALLA_* lines for deploy/.env.
#
# DIR defaults to $VALHALLA_DATA or deploy/valhalla-data (gitignored). Never commit extracts or
# tiles. Requires curl and docker; JSON work runs inside the pinned image (which ships jq).
set -euo pipefail

# Pinned image (multi-arch index; linux/amd64 and linux/arm64 checked 2026-10-05).
IMAGE_TAG="ghcr.io/valhalla/valhalla-scripted:3.9.0"
IMAGE_DIGEST="sha256:89daaf61547167893cf58c03defd43c6eba0071dc965988c16a629260f8ac683"
IMAGE="ghcr.io/valhalla/valhalla-scripted@${IMAGE_DIGEST}"
GEOFABRIK="${GEOFABRIK_URL:-https://download.geofabrik.de}"
# OpenStreetMapSpeeds default speeds, pinned to a commit instead of the image's moving master URL.
SPEEDS_COMMIT="c9c6872d5ec656f5d290944b44eb1a103ed539fa"
SPEEDS_URL="https://raw.githubusercontent.com/OpenStreetMapSpeeds/schema/${SPEEDS_COMMIT}/default_speeds.json"
# Service limits. max_matrix_distance must cover the requested point extent (a depot and an
# indirectly reachable stop can be farther apart than the 500 mi leg limit). It also sets
# CostMatrix's search cost threshold: at 1,000 km, truck legs of 750-900 road km (8+ h at truck
# speeds) came back null on the OK/TX/NM/CO/KS/MO/AR tiles although /route found them, and Fillrate
# reads null as unreachable. 2,000 km returned every pair (docs/valhalla.md). Keep pairs and
# Fillrate's VALHALLA_MAX_MATRIX_* in step: `env` prints both from the same values.
MAX_MATRIX_DISTANCE_M="${VALHALLA_MAX_MATRIX_DISTANCE_M:-2000000}"
MAX_MATRIX_PAIRS="${VALHALLA_MAX_MATRIX_PAIRS:-2500}"
MAX_ROUTE_LOCATIONS="${VALHALLA_MAX_ROUTE_LOCATIONS:-20}"
# Truck costing sent with every request (Valhalla 3.9.0 truck defaults, written out explicitly so
# the matrix identity records them): 53 ft tractor-trailer combination.
COSTING_OPTIONS='{"axle_count":5,"axle_load":9.07,"hazmat":false,"height":4.11,"length":21.64,"weight":21.77,"width":2.6}'

here="$(cd "$(dirname "$0")" && pwd)"
dir="${VALHALLA_DATA:-$here/../valhalla-data}"
mode=prepare
if [[ "${1:-}" == "env" ]]; then mode=env; shift; fi
while getopts "d:" opt; do
  case "$opt" in
    d) dir="$OPTARG" ;;
    *) sed -n '2,13p' "$0"; exit 2 ;;
  esac
done
shift $((OPTIND - 1))

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
md5() { if command -v md5sum >/dev/null; then md5sum "$1" | cut -d' ' -f1; else md5 -q "$1"; fi; }
in_image() { docker run --rm -i --user "$(id -u):$(id -g)" -v "$dir:/custom_files" --entrypoint sh "$IMAGE" -c "$1"; }

if [[ "$mode" == "env" ]]; then
  [[ -f "$dir/extract-meta.json" ]] || { echo "no extract-meta.json in $dir; run prepare first" >&2; exit 1; }
  [[ -f "$dir/valhalla_tiles.tar" && -f "$dir/file_hashes.txt" ]] || { echo "tiles not built yet in $dir; start the valhalla service and wait for it" >&2; exit 1; }
  # Graph identity: the effective server configuration plus the built tile archive.
  config="$(sha256 "$dir/valhalla.json")"
  tiles="$(sha256 "$dir/valhalla_tiles.tar")"
  graph="$(printf 'valhalla.json:%s\nvalhalla_tiles.tar:%s\n' "$config" "$tiles" | { if command -v sha256sum >/dev/null; then sha256sum; else shasum -a 256; fi; } | cut -d' ' -f1)"
  revision="$(in_image 'jq -r .dataset_revision /custom_files/extract-meta.json')"
  echo "VALHALLA_URL=${VALHALLA_URL:-http://valhalla:8002}"
  echo "VALHALLA_VERSION=${IMAGE_TAG}@${IMAGE_DIGEST}"
  echo "VALHALLA_DATASET_REVISION=${revision}"
  echo "VALHALLA_GRAPH_CONFIG_HASH=sha256:${graph}"
  echo "VALHALLA_COSTING_OPTIONS='${COSTING_OPTIONS}'"  # quoted: valid in a shell and in Compose env files
  echo "VALHALLA_MAX_MATRIX_DISTANCE_M=${MAX_MATRIX_DISTANCE_M}"
  echo "VALHALLA_MAX_MATRIX_PAIRS=${MAX_MATRIX_PAIRS}"
  echo "VALHALLA_MAX_ROUTE_LOCATIONS=${MAX_ROUTE_LOCATIONS}"
  exit 0
fi

[[ $# -ge 1 ]] || { sed -n '2,13p' "$0"; exit 2; }
mkdir -p "$dir"
dir="$(cd "$dir" && pwd)"
entries=()
regions=()
for region in "$@"; do
  [[ "$region" =~ ^[a-z0-9-]+(/[a-z0-9-]+)*$ ]] || { echo "invalid Geofabrik region path: $region" >&2; exit 2; }
  name="$(basename "$region")"
  url="$GEOFABRIK/$region-latest.osm.pbf"
  file="$dir/$name.osm.pbf"
  expected="$(curl -fsSL "$url.md5" | cut -d' ' -f1)"
  if [[ -f "$file" && "$(md5 "$file")" == "$expected" ]]; then
    echo "Keeping $file (matches Geofabrik's current MD5)"
    headers="$(curl -fsSIL "$url")"
  else
    echo "Downloading $url"
    headers="$(curl -fsSL -o "$file.part" -D - "$url")"
    [[ "$(md5 "$file.part")" == "$expected" ]] || { rm -f "$file.part"; echo "MD5 mismatch for $url" >&2; exit 1; }
    mv "$file.part" "$file"
  fi
  modified="$(printf '%s' "$headers" | tr -d '\r' | awk -F': ' 'tolower($1)=="last-modified"{v=$2} END{print v}')"
  entries+=("$(printf '{"region":"%s","url":"%s","file":"%s","last_modified":"%s","md5":"%s","sha256":"%s","bytes":%s}' \
    "$region" "$url" "$name.osm.pbf" "$modified" "$expected" "$(sha256 "$file")" "$(wc -c <"$file" | tr -d ' ')")")
  regions+=("$name")
done
# Remove extracts from earlier preparations so the tile build covers exactly these regions.
for old in "$dir"/*.osm.pbf; do
  keep=no
  for name in "${regions[@]}"; do [[ "$old" == "$dir/$name.osm.pbf" ]] && keep=yes; done
  [[ $keep == yes ]] || { echo "Removing old extract $old"; rm -f "$old"; }
done

echo "Downloading pinned default speeds ($SPEEDS_COMMIT)"
curl -fsSL -o "$dir/default_speeds.json" "$SPEEDS_URL"

previous=""
[[ -f "$dir/extract-meta.json" ]] && previous="$(in_image 'jq -c "[.extracts[].sha256]" /custom_files/extract-meta.json' || true)"
prepared="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
joined="$(IFS=,; echo "${entries[*]}")"
docker pull -q "$IMAGE" >/dev/null
in_image "jq -n --argjson raw '[$joined]' --arg image '$IMAGE_TAG@$IMAGE_DIGEST' --arg prepared '$prepared' \
  --arg speeds '$SPEEDS_URL' --arg speeds_sha '$(sha256 "$dir/default_speeds.json")' \
  --argjson limits '{\"truck_max_matrix_distance_m\":$MAX_MATRIX_DISTANCE_M,\"truck_max_matrix_location_pairs\":$MAX_MATRIX_PAIRS,\"truck_max_locations\":$MAX_ROUTE_LOCATIONS}' \
  '(\$raw | map(. + {extract_date: (.last_modified | strptime(\"%a, %d %b %Y %H:%M:%S GMT\") | todate)})) as \$extracts |
   {image:\$image, prepared_at:\$prepared, extracts:\$extracts, default_speeds:{url:\$speeds, sha256:\$speeds_sha}, limits:\$limits,
    dataset_revision: (\"geofabrik:\" + ([\$extracts[] | (.region | split(\"/\") | last) + \"@\" + .extract_date + \"#\" + .md5[0:12]] | join(\",\")))}' \
  > /custom_files/extract-meta.json"
# Fillrate records the revision with each snapshot and accepts at most 200 characters. A long extract
# list (several states) is recorded as region names, the newest extract date and a digest of the full
# per-extract revision, which stays in extract-meta.json as dataset_revision_full.
full="$(in_image 'jq -r .dataset_revision /custom_files/extract-meta.json')"
if (( ${#full} > 200 )); then
  digest="$(printf '%s' "$full" | { if command -v sha256sum >/dev/null; then sha256sum; else shasum -a 256; fi; } | cut -c1-16)"
  newest="$(in_image 'jq -r "[.extracts[].extract_date] | max" /custom_files/extract-meta.json')"
  names="$(in_image 'jq -r "[.extracts[].region | split(\"/\") | last] | join(\",\")" /custom_files/extract-meta.json')"
  compact="geofabrik:${names}@${newest}#sha256:${digest}"
  (( ${#compact} <= 200 )) || compact="geofabrik:$(in_image 'jq -r ".extracts | length" /custom_files/extract-meta.json')-extracts@${newest}#sha256:${digest}"
  in_image "jq --arg c '$compact' '.dataset_revision_full = .dataset_revision | .dataset_revision = \$c' /custom_files/extract-meta.json > /custom_files/extract-meta.json.tmp && mv /custom_files/extract-meta.json.tmp /custom_files/extract-meta.json"
fi

# Service limits for the truck costing, and CostMatrix search limits. With Valhalla's defaults the
# truck matrix returned no path (null) for Nashville <-> Jackson, MS (669 km by road) on the
# TN/MS/AR tiles; raising the hierarchy transitions found it (docs/valhalla.md). A null edge must mean
# "no road path", not "search gave up". Release Thor search buffers between requests on shared hosts;
# this preserves search limits but can trade some repeat-request speed for lower retained memory.
# The container merges this file with its own paths on start.
in_image "valhalla_build_config \
  --mjolnir-tile-dir /custom_files/valhalla_tiles --mjolnir-tile-extract /custom_files/valhalla_tiles.tar \
  --mjolnir-admin /custom_files/admins.sqlite --mjolnir-timezone /custom_files/timezones.sqlite \
  --service-limits-truck-max-matrix-distance $MAX_MATRIX_DISTANCE_M \
  --service-limits-truck-max-matrix-location-pairs $MAX_MATRIX_PAIRS \
  --service-limits-truck-max-locations $MAX_ROUTE_LOCATIONS \
  --thor-clear-reserved-memory True \
  --thor-costmatrix-allow-second-pass True \
  --thor-costmatrix-max-iterations 20000 \
  --thor-costmatrix-hierarchy-limits-max-up-transitions-1 4000 \
  --thor-costmatrix-hierarchy-limits-max-up-transitions-2 1000 \
  | jq '.mjolnir.default_speeds_config = \"/custom_files/default_speeds.json\"' > /custom_files/valhalla.json"
# A changed extract set must rebuild. The image's hash list keys on file names, not content, so a
# refreshed extract with the same name would not rebuild: drop the old tiles, admins and hash list.
current="$(in_image 'jq -c "[.extracts[].sha256]" /custom_files/extract-meta.json')"
if [[ "$current" != "$previous" ]]; then
  echo "Extract set changed: removing old tiles so the container rebuilds them"
  rm -rf "$dir/valhalla_tiles" "$dir/valhalla_tiles.tar" "$dir/file_hashes.txt" "$dir/admins.sqlite"
else
  echo "Extracts unchanged: keeping the built tiles (restart the service to apply new limits)"
fi

echo "Prepared $dir:"
in_image 'jq -r ".dataset_revision, .limits" /custom_files/extract-meta.json'
echo "Next: docker compose --profile valhalla up -d (tiles build on first start), then: $0 env -d $dir"
