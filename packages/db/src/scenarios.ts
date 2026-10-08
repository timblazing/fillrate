import { createHash, randomUUID } from "node:crypto";
import { parseContract, type ScenarioDocument, type Snapshot } from "@fillrate/contracts";
import { canonical, OPERATOR, type Store } from "./index";

export type ScenarioMetadata = { timezone: string; planningDate: string; browserId: string };
export function validateScenario(input: unknown): ScenarioDocument {
  const doc = parseContract("ScenarioDocument", input);
  if (!doc.name.trim() || doc.name.length > 200 || doc.orders.length > 5000 || doc.locations.length > 10000) throw new Error("invalid_scenario_limits");
  const unique = (ids: string[]) => { if (new Set(ids).size !== ids.length) throw new Error("duplicate_id"); };
  unique(doc.orders.map(x => x.id)); unique(doc.locations.map(x => x.id)); unique(doc.products.map(x => x.id));
  unique(doc.orders.flatMap(x => x.lines.map(l => l.id))); unique(doc.inventory.map(x => x.product_id));
  const products = new Set(doc.products.map(x => x.id)), locations = new Set(doc.locations.map(x => x.id));
  for (const order of doc.orders) {
    if (!locations.has(order.location_id) || !/^\d{4}-\d{2}-\d{2}$/.test(order.order_date) || new Date(order.order_date).toISOString().slice(0, 10) !== order.order_date) throw new Error("invalid_order_reference_or_date");
    for (const line of order.lines) if (!products.has(line.product_id)) throw new Error("invalid_product_reference");
  }
  for (const item of doc.inventory) if (!products.has(item.product_id)) throw new Error("invalid_inventory_reference");
  for (const location of doc.locations) if ((location.lat === null) !== (location.lon === null)) throw new Error("incomplete_coordinate");
  canonical(doc);
  return doc;
}
export function validateMetadata(input: ScenarioMetadata) {
  new Intl.DateTimeFormat("en", { timeZone: input.timezone });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.planningDate) || new Date(input.planningDate).toISOString().slice(0, 10) !== input.planningDate || !input.browserId || input.browserId.length > 200) throw new Error("invalid_metadata");
  return input;
}
// Solver Lab instances are stored as versions too (packages/db/src/lab.ts); they are not scenarios.
const NOT_LAB = "coalesce(json_extract(v.document, '$.document.kind'), '') <> 'lab_instance'";
/** One owner's scenarios at their latest revision (bundled examples and lab instances are never listed). */
export function scenarioList(store: Store, ownerId = OPERATOR) {
  return store.sqlite.prepare(`SELECT s.id, s.name, v.id AS versionId, v.revision, v.author, v.createdAt, json_extract(v.document,'$.document.depot.label') AS depotLabel, (SELECT COUNT(*) FROM json_each(v.document,'$.document.orders')) AS orderCount, (SELECT parentVersionId FROM scenario_versions WHERE scenarioId=s.id AND revision=1) AS branchedFrom FROM scenarios s JOIN scenario_versions v ON v.scenarioId=s.id WHERE s.ownerId=? AND ${NOT_LAB} AND v.revision=(SELECT MAX(revision) FROM scenario_versions WHERE scenarioId=s.id) ORDER BY v.createdAt DESC LIMIT 100`).all(ownerId);
}
/** A version of one owner's scenario; another owner's scenario (or a lab instance) reads as missing. */
export function scenarioVersion(store: Store, scenarioId: string, versionId?: string, ownerId = OPERATOR) {
  if (store.scenarioOwner(scenarioId) !== ownerId) throw new Error("scenario_not_found");
  const row = store.sqlite.prepare(`SELECT * FROM scenario_versions v WHERE scenarioId=? AND ${NOT_LAB} ${versionId ? "AND id=?" : "ORDER BY revision DESC LIMIT 1"}`).get(...(versionId ? [scenarioId, versionId] : [scenarioId])) as { id: string; scenarioId: string; revision: number; parentVersionId: string | null; document: string; author: string; createdAt: number } | undefined;
  if (!row) throw new Error("scenario_not_found");
  const source = store.sqlite.prepare("SELECT source, metadata FROM scenario_sources WHERE versionId=?").get(row.id) as { source: string; metadata: string } | undefined;
  return { ...row, document: JSON.parse(row.document).document as ScenarioDocument, source: source ? JSON.parse(source.source) : null, metadata: source ? JSON.parse(source.metadata) as ScenarioMetadata : null };
}
export function saveScenario(store: Store, input: { document: unknown; author: string; metadata: ScenarioMetadata; source?: unknown; scenarioId?: string; expectedVersionId?: string; branch?: boolean; idempotencyKey?: string; requestPayload?: unknown; ownerId?: string }) {
  const ownerId = input.ownerId ?? OPERATOR;
  if (ownerId === "examples" || ownerId === "public") throw new Error("invalid_owner");
  const doc = validateScenario(input.document), metadata = validateMetadata(input.metadata);
  if (!input.author?.trim() || input.author.length > 100) throw new Error("invalid_author");
  const source = canonical(input.source ?? null);
  if (Buffer.byteLength(source) > 8 * 1024 * 1024 || Buffer.byteLength(canonical(doc)) > 8 * 1024 * 1024) throw new Error("scenario_too_large");
  const snapshot = { schema_version: 1, document: doc } as unknown as Snapshot;
  if (input.idempotencyKey !== undefined && (!input.idempotencyKey || input.idempotencyKey.length > 200)) throw new Error("invalid_idempotency_key");
  const requestHash = createHash("sha256").update(canonical(input.requestPayload === undefined ? { document: doc, author: input.author.trim(), metadata, source: input.source ?? null, scenarioId: input.scenarioId ?? null, expectedVersionId: input.expectedVersionId ?? null, branch: Boolean(input.branch) } : { scenarioId: input.scenarioId ?? null, body: input.requestPayload })).digest("hex");
  return store.sqlite.transaction(() => {
    if (input.idempotencyKey) {
      const prior = store.sqlite.prepare("SELECT requestHash,scenarioId,versionId FROM scenario_saves WHERE idempotencyKey=?").get(input.idempotencyKey) as { requestHash: string; scenarioId: string; versionId: string } | undefined;
      if (prior) {
        if (prior.requestHash !== requestHash || store.scenarioOwner(prior.scenarioId) !== ownerId) throw new Error("idempotency_conflict");
        return { scenarioId: prior.scenarioId, versionId: prior.versionId };
      }
    }
    let scenarioId = input.scenarioId, versionId: string;
    if (scenarioId && store.scenarioOwner(scenarioId) !== ownerId) throw new Error("scenario_not_found");
    if (scenarioId && store.sqlite.prepare(`SELECT 1 FROM scenario_versions v WHERE scenarioId=? AND NOT (${NOT_LAB}) LIMIT 1`).get(scenarioId)) throw new Error("scenario_not_found");
    if (scenarioId && input.branch) {
      if (!input.expectedVersionId) throw new Error("version_required");
      scenarioVersion(store, scenarioId, input.expectedVersionId, ownerId);
      scenarioId = randomUUID(); versionId = randomUUID();
      store.sqlite.prepare("INSERT INTO scenarios (id,name,createdAt,ownerId) VALUES (?,?,?,?)").run(scenarioId, doc.name, Date.now(), ownerId);
      store.sqlite.prepare("INSERT INTO scenario_versions (id,scenarioId,revision,schemaVersion,parentVersionId,document,author,createdAt) VALUES (?,?,1,1,?,?,?,?)").run(versionId, scenarioId, input.expectedVersionId, canonical(snapshot), input.author.trim(), Date.now());
    } else if (scenarioId) {
      if (!input.expectedVersionId) throw new Error("version_required");
      versionId = store.saveVersion(scenarioId, input.expectedVersionId, snapshot, input.author.trim());
    } else {
      const created = store.createScenario(doc.name, snapshot, input.author.trim(), Date.now(), ownerId);
      scenarioId = created.scenarioId; versionId = created.versionId;
    }
    store.sqlite.prepare("INSERT INTO scenario_sources (versionId,source,metadata) VALUES (?,?,?)").run(versionId, source, canonical(metadata));
    if (input.idempotencyKey) store.sqlite.prepare("INSERT INTO scenario_saves (idempotencyKey,requestHash,scenarioId,versionId,createdAt) VALUES (?,?,?,?,?)").run(input.idempotencyKey, requestHash, scenarioId, versionId, Date.now());
    return { scenarioId, versionId };
  }).immediate();
}
