// Python reproduction bundle (spec §13, M4 exit evidence): a zip with the scenario, the recorded
// settings, the deterministic stage artifacts, the pinned optimizer source and lock file, and a
// replay script. It runs without web credentials, network or live geocoding.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { crc32 } from "node:zlib";
import type { RunSummary } from "@fillrate/contracts";
import type { Store } from "./index";

export const MAX_BUNDLE_BYTES = 16 * 1024 * 1024;
const DETERMINISTIC = ["preflight", "allocation", "aggregation", "clustering"] as const;

/** Files the bundle needs from services/optimizer: project metadata, the lock and the package source. */
function optimizerFiles(sourceDir: string) {
  const files: [string, Buffer][] = [];
  // next.config.ts includes these replay assets explicitly; Docker also copies them to /app/optimizer.
  for (const name of ["pyproject.toml", "uv.lock", ".python-version"]) files.push([`optimizer/${name}`, readFileSync(/* turbopackIgnore: true */ join(/* turbopackIgnore: true */ sourceDir, name))]);
  const pkg = join(/* turbopackIgnore: true */ sourceDir, "src/fillrate_optimizer");
  for (const name of readdirSync(/* turbopackIgnore: true */ pkg).sort()) {
    const path = join(/* turbopackIgnore: true */ pkg, name);
    if (name.endsWith(".py") && statSync(/* turbopackIgnore: true */ path).isFile()) files.push([`optimizer/${relative(sourceDir, path)}`, readFileSync(/* turbopackIgnore: true */ path)]);
  }
  return files;
}

export function replayBundle(store: Store, runId: string, sourceDir: string) {
  const view = store.runView(runId);
  if (!view) throw new Error("run_not_found");
  if (view.kind !== "pipeline" || view.status !== "succeeded") throw new Error("run_not_replayable");
  const summaryManifest = view.artifacts.find(a => a.stage_type === "summary");
  if (!summaryManifest) throw new Error("run_not_replayable");
  const summary = store.readArtifact(summaryManifest.output_hash) as RunSummary;
  const scenario = store.versionDocument(view.versionId).document;
  const settings = view.settings.document;
  const deterministic = Object.fromEntries(DETERMINISTIC.map(stage => [stage, view.artifacts.find(a => a.stage_type === stage)?.output_hash ?? null]));
  const expected = {
    run_id: runId,
    validity: summary.validity,
    coverage: summary.coverage,
    totals: summary.totals,
    clustering: summary.clustering,
    versions: summary.versions,
    deterministic_output_hashes: deterministic,
    iteration_based: Boolean((settings as { solver_max_iterations?: number | null }).solver_max_iterations),
  };
  const json = (value: unknown) => Buffer.from(JSON.stringify(value, null, 1) + "\n");
  const files: [string, Buffer][] = [
    ["README.md", Buffer.from(readme(runId, expected.iteration_based))],
    ["replay.py", Buffer.from(REPLAY_PY)],
    ["scenario.json", json(scenario)],
    ["settings.json", json(settings)],
    ["expected.json", json(expected)],
    ...DETERMINISTIC.flatMap(stage => {
      const manifest = view.artifacts.find(a => a.stage_type === stage);
      return manifest ? [[`artifacts/${stage}.json`, json({ manifest, payload: store.readArtifact(manifest.output_hash) })] as [string, Buffer]] : [];
    }),
    ...optimizerFiles(sourceDir),
  ];
  const zip = zipStore(files);
  if (zip.length > MAX_BUNDLE_BYTES) throw new Error("bundle_too_large");
  return zip;
}

function readme(runId: string, iterationBased: boolean) {
  return `# Fillrate replay: run ${runId}

Reproduces this pipeline run offline from the files in this folder: \`scenario.json\` (the saved
scenario version), \`settings.json\` (the recorded run settings), the pinned optimizer source in
\`optimizer/\` with its \`uv.lock\`, and \`artifacts/\` (the recorded preflight, allocation,
aggregation and clustering outputs). No web credentials, network access or geocoding are needed.

    uv run --project optimizer python replay.py

(Python 3.13; or \`pip install ./optimizer\` and \`python replay.py\`.)

The script reruns the pipeline and checks:

1. The deterministic stages (preflight, allocation, aggregation, clustering) reproduce the recorded
   output hashes exactly.
2. The plan is validated again and its feasibility, coverage, shipments, planned revenue and loaded
   miles are compared with \`expected.json\`.

${iterationBased
    ? "This run used an iteration budget, so on the same pinned versions and platform the solve is expected to reproduce exactly. A difference is reported and fails the replay."
    : "This run used a time budget. Time-limited search does not reproduce exactly across machines, so solver metrics are reported, not required to match. Pass `--iterations N` to rerun with a fixed iteration budget (iteration-based reproduction mode)."}

Ties in route order are not compared; only cost and feasibility are. Units: meters, cents, and
hundredths of a foot.
`;
}

const REPLAY_PY = `"""Replays a Fillrate pipeline run from this bundle. See README.md."""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "optimizer" / "src"))

from fillrate_optimizer.model import RunSettings, ScenarioDocument  # noqa: E402
from fillrate_optimizer.pipeline import run_pipeline, versions  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--iterations", type=int, help="Rerun with a fixed solver iteration budget.")
    args = parser.parse_args()
    expected = json.loads((ROOT / "expected.json").read_text())
    scenario = ScenarioDocument.model_validate(json.loads((ROOT / "scenario.json").read_text()))
    settings = RunSettings.model_validate(json.loads((ROOT / "settings.json").read_text()))
    exact = expected["iteration_based"]
    if args.iterations:
        settings = settings.model_copy(update={"solver_max_iterations": args.iterations})
        exact = False
    local = versions()
    drift = {k: (v, local.get(k)) for k, v in expected["versions"].items() if local.get(k) != v}
    if drift:
        print(f"note: versions differ from the recording: {drift}")
        exact = False

    output = run_pipeline(scenario, settings)
    failures = []
    hashes = {a.stage: a.manifest["output_hash"] for a in output.artifacts}
    for stage, recorded in expected["deterministic_output_hashes"].items():
        ok = recorded is None or hashes.get(stage) == recorded
        print(f"{stage:<12} {'reproduced' if ok else 'DIFFERS'}")
        if not ok:
            failures.append(stage)

    summary, totals = output.summary, expected["totals"]
    rows = [
        ("validity", expected["validity"], summary.validity),
        ("coverage", expected["coverage"], summary.coverage),
        ("shipments", totals["trucks"], summary.totals.trucks),
        ("planned_cents", totals["planned_cents"], summary.totals.planned_cents),
        ("loaded_distance_m", totals["loaded_distance_m"], summary.totals.loaded_distance_m),
    ]
    for name, recorded, now in rows:
        same = recorded == now
        print(f"{name:<18} recorded {recorded!s:<12} replay {now!s:<12} {'=' if same else '≠'}")
        if not same and (exact or name in ("validity",)):
            failures.append(name)
    if not exact:
        print("solver metrics are informational: time budget, override or version drift (see README)")
    print("REPLAY OK" if not failures else f"REPLAY FAILED: {', '.join(failures)}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
`;

/** Minimal ZIP writer (stored entries, no compression) so the bundle needs no dependency. */
export function zipStore(files: [string, Buffer][]) {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  // Fixed DOS timestamp (1980-01-01) keeps the bundle byte-identical for identical inputs.
  for (const [name, data] of files) {
    const nameBytes = Buffer.from(name, "utf8"), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data); centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
