#!/usr/bin/env python3
"""Check a running Valhalla's coverage and truck matrix/route behavior for Fillrate (docs/valhalla.md).

    python3 -I deploy/valhalla/region_check.py <valhalla-url> <points.json> [--max-block 50]

points.json: {"inside": [[label, lat, lon], ...], "outside": [[label, lat, lon], ...],
              "matrix": [[label, lat, lon], ...]  (optional; defaults to inside; keep its extent inside
                                                   the service's max_matrix_distance),
              "costing_options": {...truck options, as printed by prepare.sh env...}}
Checks: every inside point locates on a truck edge and every outside point does not; a directed
matrix × matrix truck matrix has a path for every pair (null means unreachable to Fillrate); one route
returns road geometry; a max-size block (n × n inside the extent, n = --max-block) completes. Prints JSON
timings. Standard library only, so it runs on any host with Python 3 and network access to the service.
"""
import json
import random
import sys
import time
import urllib.request


def post(url, body):
    request = urllib.request.Request(url, json.dumps(body).encode(), {"content-type": "application/json"})
    started = time.monotonic()
    with urllib.request.urlopen(request, timeout=600) as response:
        payload = json.load(response)
    return payload, round((time.monotonic() - started) * 1000, 1)


def main():
    args = sys.argv[1:]
    if len(args) < 2:
        print(__doc__)
        return 2
    base = args[0].rstrip("/")
    with open(args[1]) as handle:
        spec = json.load(handle)
    n = int(args[args.index("--max-block") + 1]) if "--max-block" in args else 50
    costing = {"truck": spec.get("costing_options", {})}
    report, failures = {}, []

    def locate(points):
        located, ms = post(f"{base}/locate", {"locations": [{"lat": p[1], "lon": p[2]} for p in points], "costing": "truck", "costing_options": costing, "verbose": False})
        return [bool(item.get("edges")) for item in located], ms

    inside, outside = spec["inside"], spec.get("outside", [])
    found, report["locate_inside_ms"] = locate(inside)
    failures += [f"inside point not on the graph: {p[0]}" for p, ok in zip(inside, found, strict=True) if not ok]
    if outside:
        found, report["locate_outside_ms"] = locate(outside)
        failures += [f"outside point located: {p[0]}" for p, ok in zip(outside, found, strict=True) if ok]

    pts = spec.get("matrix", inside)
    locations = [{"lat": p[1], "lon": p[2]} for p in pts]
    matrix, ms = post(f"{base}/sources_to_targets", {"sources": locations, "targets": locations, "costing": "truck", "costing_options": costing, "units": "kilometers"})
    rows = matrix["sources_to_targets"]
    missing = [(pts[i][0], pts[j][0]) for i, row in enumerate(rows) for j, cell in enumerate(row) if i != j and cell.get("time") is None]
    failures += [f"no truck path {a} -> {b}" for a, b in missing]
    asym = sum(1 for i, row in enumerate(rows) for j, cell in enumerate(row) if i < j and cell.get("distance") != rows[j][i].get("distance"))
    report["matrix"] = {"size": f"{len(pts)}x{len(pts)}", "ms": ms, "missing_pairs": len(missing), "asymmetric_pairs": asym,
                        "example_km": {f"{pts[0][0]}->{pts[1][0]}": rows[0][1].get("distance"), f"{pts[1][0]}->{pts[0][0]}": rows[1][0].get("distance")}}

    route, ms = post(f"{base}/route", {"locations": locations[:2], "costing": "truck", "costing_options": costing, "units": "kilometers"})
    summary = route["trip"]["summary"]
    report["route"] = {"from": pts[0][0], "to": pts[1][0], "ms": ms, "km": round(summary["length"], 1), "hours": round(summary["time"] / 3600, 2), "shape_chars": sum(len(leg["shape"]) for leg in route["trip"]["legs"])}
    if not report["route"]["shape_chars"]:
        failures.append("route returned no geometry")

    lats, lons = [p[1] for p in pts], [p[2] for p in pts]
    rng = random.Random(0)
    block = [{"lat": rng.uniform(min(lats), max(lats)), "lon": rng.uniform(min(lons), max(lons))} for _ in range(n)]
    snapped, _ = post(f"{base}/locate", {"locations": block, "costing": "truck", "costing_options": costing, "verbose": False})
    block = [loc for loc, item in zip(block, snapped, strict=True) if item.get("edges")]
    big, ms = post(f"{base}/sources_to_targets", {"sources": block, "targets": block, "costing": "truck", "costing_options": costing, "units": "kilometers"})
    nulls = sum(1 for row in big["sources_to_targets"] for cell in row if cell.get("time") is None)
    report["max_block"] = {"size": f"{len(block)}x{len(block)}", "ms": ms, "null_pairs": nulls}

    report["ok"] = not failures
    report["failures"] = failures
    print(json.dumps(report, indent=2))
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
