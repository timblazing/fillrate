// Python reproduction bundle (spec §13, M4 exit evidence): a zip with the scenario, the recorded
// settings, the deterministic stage artifacts, the pinned optimizer source and lock file, and a
// replay script. k explorer jobs get their own bundle (`explorerReplayBundle`, M7). It runs without web credentials, network or live geocoding.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import type { ExplorerSettings, ExplorerSummary, RunSummary } from "@fillrate/contracts";
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
  if (view.kind === "explorer" && view.status === "succeeded") return explorerReplayBundle(store, runId, sourceDir);
  if (view.kind !== "pipeline" || view.status !== "succeeded") throw new Error("run_not_replayable");
  const summaryManifest = view.artifacts.find(a => a.stage_type === "summary");
  if (!summaryManifest) throw new Error("run_not_replayable");
  const summary = store.readArtifact(summaryManifest.output_hash) as RunSummary;
  const scenario = store.versionDocument(view.versionId).document;
  // Runs stored before road travel was removed carry a null `travel_snapshot_id`, which current settings reject.
  const settings: Record<string, unknown> = { ...view.settings.document };
  delete settings.travel_snapshot_id;
  const deterministic = Object.fromEntries(DETERMINISTIC.map(stage => [stage, view.artifacts.find(a => a.stage_type === stage)?.output_hash ?? null]));
  const expected = {
    run_id: runId,
    validity: summary.validity,
    coverage: summary.coverage,
    totals: summary.totals,
    clustering: summary.clustering,
    versions: summary.versions,
    deterministic_output_hashes: deterministic,
    // Allocation identity is always checked. Travel is the estimated matrix; any other provider is refused.
    allocation: summary.allocation ? { strategy: summary.allocation.strategy, fulfillment_policy: summary.allocation.fulfillment_policy } : undefined,
    travel: { provider: "estimated", circuity: (settings as { travel_circuity?: number }).travel_circuity ?? 1.2 },
    iteration_based: Boolean((settings as { solver_max_iterations?: number | null }).solver_max_iterations),
  };
  const json = (value: unknown) => Buffer.from(JSON.stringify(value, null, 1) + "\n");
  const files: [string, Buffer, boolean?][] = [
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
  // The 16 MiB bound covers the scenario, settings, artifacts and source.
  if (files.reduce((n, [, data, deflate]) => n + (deflate ? 0 : data.length), 0) > MAX_BUNDLE_BYTES) throw new Error("bundle_too_large");
  return zipStore(files);
}

/**
 * k explorer bundle (spec §8a, §9, §13; M7): the scenario version, the recorded `ExplorerSettings` and the recorded
 * explorer artifact in `expected.json`. The checks live in `fillrate_optimizer.explorer_replay`. The explorer
 * clusters on the spatial metric only, so the bundle declares that and nothing
 * else; the replay refuses any other provider.
 */
export function explorerReplayBundle(store: Store, runId: string, sourceDir: string) {
  const view = store.runView(runId);
  if (!view) throw new Error("run_not_found");
  if (view.kind !== "explorer" || view.status !== "succeeded") throw new Error("run_not_replayable");
  const manifest = view.artifacts.find(a => a.stage_type === "explorer");
  if (!manifest) throw new Error("run_not_replayable");
  const summary = store.readArtifact(manifest.output_hash) as ExplorerSummary;
  const settings = view.settings.document as unknown as ExplorerSettings;
  const expected = {
    kind: "explorer",
    run_id: runId,
    output_hash: manifest.output_hash,
    versions: summary.versions,
    max_tasks: summary.max_tasks,
    travel: { provider: "estimated", metric: "spatial", circuity: settings.base?.cluster_circuity ?? 1.2 },
    summary,
  };
  const json = (value: unknown) => Buffer.from(JSON.stringify(value, null, 1) + "\n");
  const files: [string, Buffer][] = [
    ["README.md", Buffer.from(explorerReadme(runId, summary))],
    ["replay.py", Buffer.from(EXPLORER_REPLAY_PY)],
    ["scenario.json", json(store.versionDocument(view.versionId).document)],
    ["settings.json", json(settings)],
    ["expected.json", json(expected)],
    ["artifacts/explorer.json", json({ manifest, payload: summary })],
    ...optimizerFiles(sourceDir),
  ];
  if (files.reduce((n, [, data]) => n + data.length, 0) > MAX_BUNDLE_BYTES) throw new Error("bundle_too_large");
  return zipStore(files);
}

function explorerReadme(runId: string, summary: ExplorerSummary) {
  return `# Fillrate replay: k explorer ${runId}

Recomputes this k explorer job offline from the files in this folder: \`scenario.json\` (the saved
scenario version), \`settings.json\` (the recorded explorer settings: k range ${summary.ks.join(", ")}, seeds
${summary.seeds.join(", ")}, reference seed ${summary.reference_seed}, H3 resolutions ${summary.h3.map(r => r.resolution).join(", ") || "none"}),
the pinned optimizer source in \`optimizer/\` with its \`uv.lock\`, and \`expected.json\` (the recorded
explorer statistics; \`artifacts/explorer.json\` is the same artifact with its manifest). No web
credentials, network access or geocoding are needed.

    uv run --project optimizer python replay.py

(Python 3.13; or \`pip install ./optimizer\` and \`python replay.py\`.)

The script reruns the explorer with the recorded task allowance (${summary.max_tasks}) and checks:

1. Exactly equal: the clustered location population (${summary.locations_clustered} locations and their
   coordinates), the k range and selected k, the task and k-means fit counts, raw and effective
   cluster counts, diameter-repair counts per seed, H3 cluster counts and each location's reference
   cluster.
2. Equal within a relative tolerance of 1e-9 (absolute 1e-12): inertia per seed and its mean,
   raw and repaired stability (mean pairwise adjusted Rand index), per-location seed agreement and
   H3 inertia. On the pinned versions and the same platform the replay is normally bit-identical,
   and the script says so. Another CPU or BLAS build can change the last bits of a sum of squares;
   a different partition changes counts, labels or the statistics by far more than the tolerance
   and fails.
3. Travel: the explorer clusters on the spatial metric (straight-line distance × the recorded
   cluster circuity) and never reads a travel matrix. A bundle that declares any other provider
   is refused instead of replayed.

Different package versions are reported; differences still fail. These statistics describe how the
groupings behave across seeds. They are not solver objectives or probabilities of correctness.
`;
}

const EXPLORER_REPLAY_PY = `"""Replays a Fillrate k explorer job from this bundle. See README.md."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "optimizer" / "src"))

from fillrate_optimizer.explorer_replay import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main(root=ROOT))
`;

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
   outputs exactly. Measured runtimes (\`runtime_s\`) are provenance and are left out of the
   comparison.
2. The allocation strategy and fulfillment policy match the recording, and the plan is validated
   again: its feasibility must match, and its coverage, shipments, planned revenue and loaded miles
   are compared with \`expected.json\`.
3. Travel is the estimated matrix (straight-line distance × the recorded circuity factor). A bundle
   that declared another provider would be refused instead of replayed with estimated travel.

${iterationBased
    ? "This run used an iteration budget, so on the same pinned versions and platform the solve is expected to reproduce exactly. A difference is reported and fails the replay."
    : "This run used a time budget. Time-limited search does not reproduce exactly across machines, so solver metrics are reported, not required to match. Pass `--iterations N` to rerun with a fixed iteration budget (iteration-based reproduction mode)."}

Ties in route order are not compared; only cost and feasibility are. Units: meters, cents, and
hundredths of a foot.
`;
}

// The checks live in the bundled optimizer package (`fillrate_optimizer.replay`) so they are tested Python.
const REPLAY_PY = `"""Replays a Fillrate pipeline run from this bundle. See README.md."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "optimizer" / "src"))

from fillrate_optimizer.replay import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main(root=ROOT))
`;

/** Minimal ZIP writer (stored entries, no compression) so the bundle needs no dependency. */
export function zipStore(files: [string, Buffer, boolean?][]) {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  // Fixed DOS timestamp (1980-01-01) keeps the bundle byte-identical for identical inputs.
  for (const [name, original, deflate] of files) {
    const nameBytes = Buffer.from(name, "utf8"), crc = crc32(original);
    // Method 8 (deflate) only for entries that ask for it; everything else stays stored (method 0).
    const method = deflate ? 8 : 0, data = deflate ? deflateRawSync(original, { level: 9 }) : original;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(original.length, 22); local.writeUInt16LE(nameBytes.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(original.length, 24); central.writeUInt16LE(nameBytes.length, 28);
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
