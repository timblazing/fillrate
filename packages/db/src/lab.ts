// Solver Lab runs (spec §4 "Progressive depth", M6). A lab instance is stored as a scenario version whose
// document has `kind: "lab_instance"`; those versions never appear in scenario lists and only `lab` runs may use
// them. The run's settings document is `{kind: "lab"}`; the worker re-validates the instance in Python.
import { parseContract, type LabInstance, type LabResult, type Snapshot } from "@fillrate/contracts";
import { canonical } from "./canonical";
import { EXAMPLES_OWNER, PUBLIC_OWNER, type Admission, type Store } from "./index";

export const LAB_INSTANCE_KIND = "lab_instance";
export const LAB_SETTINGS = { schema_version: 1, document: { schema_version: 1, kind: "lab" } } as unknown as Snapshot;
export const MAX_LAB_BYTES = 2 * 1024 * 1024;

// Mirrors PLANNED_FIELDS in services/optimizer/src/fillrate_optimizer/lab/schema.py: fields of capabilities that
// are planned but not implemented are refused by name, not as a generic unknown field.
const PLANNED: [where: "instance" | "client" | "vehicle_type", field: string, capability: string][] = [
  ["instance", "shipments", "paired_shipments"],
  ["client", "pickup", "pickups_and_deliveries"],
  ["client", "tw_early", "lab_time_windows"], ["client", "tw_late", "lab_time_windows"],
  ["client", "release_time", "lab_time_windows"],
  ["vehicle_type", "tw_early", "lab_time_windows"], ["vehicle_type", "tw_late", "lab_time_windows"], ["vehicle_type", "profile", "routing_profiles"],
];

export class LabInstanceError extends Error {
  constructor(readonly code: "invalid_lab_instance" | "planned_capability" | "lab_instance_too_large", message: string, readonly fields: string[] = []) { super(message); }
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/**
 * Structural and reference checks for an owner-provided instance, before anything is stored (spec §2: validate
 * public inputs in TypeScript and independently in Python). The worker's Pydantic model repeats every check.
 */
export function validateLabInstance(input: unknown): LabInstance {
  if (!isObject(input)) throw new LabInstanceError("invalid_lab_instance", "The instance must be a JSON object.");
  const items = { instance: [input], client: input.clients, vehicle_type: input.vehicle_types };
  for (const [where, field, capability] of PLANNED) {
    const list = items[where];
    if (Array.isArray(list) && list.some(x => isObject(x) && field in x)) throw new LabInstanceError("planned_capability", `planned capability ${capability}: ${where} field "${field}" is not supported yet.`, [where === "instance" ? field : `${where}s.${field}`]);
  }
  const bytes = Buffer.byteLength(canonical(input));
  if (bytes > MAX_LAB_BYTES) throw new LabInstanceError("lab_instance_too_large", `The instance is ${bytes} bytes; the limit is ${MAX_LAB_BYTES}.`);
  // The two constants default in Pydantic, but JSON Schema validation does not fill defaults, and the stored version
  // is recognized as a lab instance by its `kind`, so set them explicitly (any other value still fails below).
  let doc: LabInstance;
  try { doc = parseContract("LabInstance", { ...input, schema_version: input.schema_version ?? 1, kind: input.kind ?? LAB_INSTANCE_KIND }); }
  catch (error) { throw new LabInstanceError("invalid_lab_instance", error instanceof Error ? error.message.replace(/^invalid_LabInstance: /, "") : "Invalid instance."); }
  const problems = labInstanceProblems(doc);
  if (problems.length) throw new LabInstanceError("invalid_lab_instance", problems.slice(0, 10).join("; "));
  return doc;
}

/** The checks of `instance_problems` in lab/validate.py. */
export function labInstanceProblems(doc: LabInstance) {
  const problems: string[] = [];
  const dims = doc.dimensions.map(d => d.id);
  const unique = (kind: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) { if (seen.has(id)) problems.push(`duplicate ${kind} id "${id}"`); seen.add(id); }
  };
  unique("dimension", dims);
  unique("location", [...doc.depots.map(d => d.id), ...doc.clients.map(c => c.id)]);
  unique("vehicle type", doc.vehicle_types.map(v => v.id));
  const depotIds = new Set(doc.depots.map(d => d.id));
  for (const v of doc.vehicle_types) {
    const reloads = v.reload_depots ?? [], max = v.max_reloads ?? 0;
    for (const id of reloads) if (!depotIds.has(id)) problems.push(`vehicle type ${v.id} reload depot "${id}" is not a depot id`);
    if (new Set(reloads).size !== reloads.length) problems.push(`vehicle type ${v.id} lists a reload depot twice`);
    if (max > 0 && reloads.length === 0) problems.push(`vehicle type ${v.id} max_reloads needs at least one reload depot`);
    if (reloads.length > 0 && max === 0) problems.push(`vehicle type ${v.id} reload_depots need max_reloads of at least 1`);
  }
  for (const v of doc.vehicle_types) for (const [role, id] of [["start_depot", v.start_depot], ["end_depot", v.end_depot]] as const) if (id != null && !depotIds.has(id)) problems.push(`vehicle type ${v.id} ${role} "${id}" is not a depot id`);
  const planar = doc.coordinates === "planar";
  for (const place of [...doc.depots, ...doc.clients]) {
    const has = (k: "x" | "y" | "lat" | "lon") => place[k] !== undefined && place[k] !== null;
    if (planar && !(has("x") && has("y") && !has("lat") && !has("lon"))) problems.push(`${place.id}: planar instances need x and y (and no lat/lon)`);
    if (!planar && !(has("lat") && has("lon") && !has("x") && !has("y"))) problems.push(`${place.id}: geographic instances need lat and lon (and no x/y)`);
  }
  for (const c of doc.clients) if ((c.prize ?? 0) > 0 && c.required !== false) problems.push(`client ${c.id} has a prize but is required: set required to false to let it be skipped, or remove the prize`);
  const clientsById = new Map(doc.clients.map(c => [c.id, c]));
  const groupIds = (doc.groups ?? []).map(g => g.id);
  unique("group", groupIds);
  const memberOf = new Map<string, string>();
  for (const g of doc.groups ?? []) {
    if (new Set(g.members).size !== g.members.length) problems.push(`group ${g.id} lists a member twice`);
    for (const m of g.members) {
      const c = clientsById.get(m);
      if (!c) { problems.push(`group ${g.id} member "${m}" is not a client id`); continue; }
      if (memberOf.has(m)) problems.push(`client ${m} is in groups ${memberOf.get(m)} and ${g.id}`);
      memberOf.set(m, g.id);
      if (c.required !== false) problems.push(`group ${g.id} member ${m} must be an optional client (required: false)`);
      if ((c.prize ?? 0) > 0) problems.push(`group ${g.id} member ${m} has a prize: members carry none, the group decides`);
    }
  }
  const known = new Set(dims);
  for (const c of doc.clients) for (const key of Object.keys(c.delivery ?? {})) if (!known.has(key)) problems.push(`client ${c.id} delivers unknown dimension "${key}"`);
  for (const v of doc.vehicle_types) {
    const keys = Object.keys(v.capacity);
    if (keys.length !== known.size || keys.some(k => !known.has(k))) problems.push(`vehicle type ${v.id} capacity must name exactly the dimensions ${dims.join(", ")}`);
  }
  if (problems.length) return problems;
  for (const c of doc.clients) {
    const fits = doc.vehicle_types.some(v => dims.every(d => (c.delivery?.[d] ?? 0) <= v.capacity[d]));
    if (!fits) problems.push(`client ${c.id} delivery fits no vehicle type's capacity`);
  }
  return problems;
}

export const labSnapshot = (instance: LabInstance) => ({ schema_version: 1, document: instance }) as unknown as Snapshot;

/** Whether a version holds a lab instance (null when there is no such version). */
export function isLabVersion(store: Store, versionId: string): boolean | null {
  const row = store.sqlite.prepare("SELECT json_extract(document, '$.document.kind') AS kind FROM scenario_versions WHERE id=?").get(versionId) as { kind: string | null } | undefined;
  return row ? row.kind === LAB_INSTANCE_KIND : null;
}

/** The version holding a bundled example instance, created once under the public "examples" owner. */
export function labExampleVersion(store: Store, instance: LabInstance) {
  const snapshot = labSnapshot(instance);
  return store.findVersion(snapshot)?.id ?? store.createScenario(`Lab: ${instance.name}`, snapshot, "Fillrate examples", Date.now(), EXAMPLES_OWNER).versionId;
}

/**
 * Queues a lab run. `instance` with an `ownerId` stores (or reuses) that owner's private version and queues on it
 * in one write transaction, so a refused admission leaves nothing behind; `versionId` queues on an existing lab
 * version (a bundled example). Admission is charged in the queuing transaction like every run.
 */
export function enqueueLabRun(store: Store, target: { instance: LabInstance } | { versionId: string }, idempotencyKey: string, options: { ownerId: string; admission?: Admission; author?: string; now?: number }) {
  const now = options.now ?? Date.now();
  if ("versionId" in target) return store.enqueue(target.versionId, LAB_SETTINGS, idempotencyKey, now, 3, "lab", { ownerId: options.ownerId, admission: options.admission });
  if (options.ownerId === EXAMPLES_OWNER || options.ownerId === PUBLIC_OWNER) throw new Error("invalid_owner");
  const snapshot = labSnapshot(target.instance);
  return store.sqlite.transaction(() => {
    const versionId = store.findVersion(snapshot, options.ownerId)?.id ?? store.createScenario(`Lab: ${target.instance.name}`, snapshot, options.author ?? "Solver Lab", now, options.ownerId).versionId;
    return store.enqueue(versionId, LAB_SETTINGS, idempotencyKey, now, 3, "lab", { ownerId: options.ownerId, admission: options.admission });
  }).immediate();
}

/** The instance a lab run solved and its validated result (null until it succeeds). */
export function labRun(store: Store, runId: string) {
  const view = store.runView(runId);
  if (!view || view.kind !== "lab") return null;
  const instance = store.versionDocument(view.versionId).document as unknown as LabInstance;
  const manifest = view.artifacts.find(a => a.stage_type === "lab");
  const result = view.status === "succeeded" && manifest ? parseContract("LabResult", store.readArtifact(manifest.output_hash)) as LabResult : null;
  return { view, instance, result };
}
