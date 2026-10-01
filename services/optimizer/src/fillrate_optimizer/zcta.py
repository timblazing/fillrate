"""Build the bundled ZIP/ZCTA approximate-coordinate lookup (spec §6, §14).

Downloads the pinned Census Gazetteer ZCTA file (public domain), verifies its SHA-256 and
writes a compact tab-separated lookup: one `zcta<TAB>lat<TAB>lon` row per ZCTA, using the
Gazetteer internal point (INTPTLAT/INTPTLONG). The web server reads it for the ZIP fallback
and records `zcta-gazetteer-<vintage>` as each approximate coordinate's provenance.

A ZIP code and a ZCTA are different things: ZCTAs approximate the areas of residential ZIP
codes, and PO-box-only and unique ZIPs have no ZCTA. Those stay unresolved.

    uv run python -m fillrate_optimizer.zcta [OUT] [--source ZIP]
"""

from __future__ import annotations

import argparse
import hashlib
import io
import sys
import urllib.request
import zipfile
from pathlib import Path

VINTAGE = "2024"
DATASET = f"zcta-gazetteer-{VINTAGE}"
URL = (
    "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/"
    f"{VINTAGE}_Gazetteer/{VINTAGE}_Gaz_zcta_national.zip"
)
SHA256 = "7b85c04a131672f58b38a950eb82855d5fd4054f0bd9bc3f69aa28897a714e3d"
DEFAULT_OUT = Path(__file__).resolve().parents[4] / "data" / f"{DATASET}.tsv"


def convert(archive: bytes) -> str:
    """Gazetteer zip → lookup text. Raises on a hash mismatch or an unexpected layout."""
    digest = hashlib.sha256(archive).hexdigest()
    if digest != SHA256:
        raise ValueError(f"Gazetteer archive SHA-256 {digest} does not match the pinned {SHA256}")
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        (name,) = z.namelist()
        text = z.read(name).decode("utf-8")
    rows = [line.split("\t") for line in text.splitlines() if line.strip()]
    header = [h.strip() for h in rows[0]]
    geoid, lat, lon = (header.index(c) for c in ("GEOID", "INTPTLAT", "INTPTLONG"))
    out = [f"# {DATASET} sha256={SHA256} source={URL}", "zcta\tlat\tlon"]
    seen: set[str] = set()
    for row in rows[1:]:
        code, y, x = row[geoid].strip(), float(row[lat]), float(row[lon])
        if len(code) != 5 or not code.isdigit() or code in seen:
            raise ValueError(f"Unexpected Gazetteer GEOID {code!r}")
        if not (-90 <= y <= 90 and -180 <= x <= 180):
            raise ValueError(f"Internal point out of range for {code}")
        seen.add(code)
        out.append(f"{code}\t{y:.6f}\t{x:.6f}")
    if len(seen) < 30_000:
        raise ValueError(f"Only {len(seen)} ZCTAs; expected the national file")
    return "\n".join(out) + "\n"


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("out", nargs="?", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--source", type=Path, help="Use a downloaded archive instead of the URL")
    args = parser.parse_args(argv)
    if args.source:
        archive = args.source.read_bytes()
    else:
        with urllib.request.urlopen(URL, timeout=600) as response:  # noqa: S310 (pinned https URL)
            archive = response.read()
    lookup = convert(archive)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(lookup)
    print(f"{args.out}: {lookup.count(chr(10)) - 2} ZCTAs ({DATASET})", file=sys.stderr)


if __name__ == "__main__":
    main()
