import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ScenarioDocument } from "@fillrate/contracts";
import { openDatabase, type Store } from "../src/index";
import { createGeocodeJob, failInterruptedGeocodeJobs, geocodeDocument, geocodeJob, geocodeOneLine, normalizeAddress, parseCensusBatch, runGeocodeJob, zipFromAddress, ZCTA_DATASET, type GeocodeConfig } from "../src/geocode";
import { previewCsvImport } from "../src/imports";
import { reviewScenario } from "../src/review";
import { saveScenario, scenarioVersion } from "../src/scenarios";

// The live Census batch response format (2026-10-01): id, input, status, match type, matched address, "lon,lat", TIGER id, side.
const KNOWN: Record<string, string> = {
  "125 N MAIN ST, MEMPHIS, TN 38103": `"Match","Exact","125 N MAIN ST, MEMPHIS, TN, 38103","-90.05155413782,35.148562911373","72902684","L"`,
  "1600 PENNSYLVANIA AVE, WASHINGTON, DC 20500": `"Match","Non_Exact","1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500","-77.035189204737,38.898702605246","76225813","L"`,
};
let store: Store, dir: string, requests: string[][], config: GeocodeConfig;
const metadata = { timezone: "America/Chicago", planningDate: "2026-09-30", browserId: "test" };

/** A Census stand-in: answers known addresses, No_Match otherwise, and records every batch. */
const fakeFetch: typeof fetch = async (url, init) => {
  const href = String(url);
  if (href.includes("/locations/onelineaddress")) {
    const address = new URL(href).searchParams.get("address")!;
    const row = KNOWN[address];
    const [lon, lat] = row ? row.split('","')[3].split(",").map(Number) : [];
    return new Response(JSON.stringify({ result: { addressMatches: row ? [{ coordinates: { x: lon, y: lat }, matchedAddress: "MATCHED" }] : [] } }));
  }
  const text = await ((init!.body as FormData).get("addressFile") as Blob).text();
  const rows = text.trim().split("\n").map(line => { const [, id, address] = /^(\d+),"((?:[^"]|"")*)",,,$/.exec(line)!; return [id, address.replaceAll('""', '"')]; });
  requests.push(rows.map(r => r[1]));
  return new Response(rows.map(([id, a]) => `"${id}","${a}",${KNOWN[a] ?? '"No_Match"'}`).join("\n") + "\n");
};

function scenario(locations: Partial<ScenarioDocument["locations"][number]>[]): ScenarioDocument {
  return {
    schema_version: 1, name: "Geocode", depot: { id: "d", label: "Depot", lat: 35.1, lon: -90 },
    products: [{ id: "P", label: "P", linear_feet_per_piece: 100 }],
    locations: locations.map((l, i) => ({ id: `L${i}`, label: `L${i}`, lat: null, lon: null, coordinate_source: "unresolved", address: null, geocode: null, original: null, ...l })),
    orders: locations.map((_, i) => ({ id: `O${i}`, customer_id: null, location_id: `L${i}`, order_date: "2026-09-30", priority: 1, lines: [{ id: `l${i}`, product_id: "P", ordered_pieces: 1, net_value_per_piece_cents: 100, linear_feet_per_piece: null }] })),
    inventory: [{ product_id: "P", available_pieces: 10 }],
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fillrate-geocode-"));
  store = openDatabase(join(dir, "test.sqlite"));
  requests = [];
  const zcta = join(dir, "zcta.tsv");
  writeFileSync(zcta, `# ${ZCTA_DATASET} sha256=test source=test\nzcta\tlat\tlon\n38103\t35.153069\t-90.056536\n73301\t30.2\t-97.7\n`);
  config = { census: { url: "https://census.test/geocoder", batchSize: 2, timeoutMs: 1000 }, zctaPath: zcta, fetch: fakeFetch, now: () => new Date("2026-10-01T12:00:00Z") };
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

describe("addresses", () => {
  it("reads only a trailing ZIP, never a house number", () => {
    expect(zipFromAddress("125 N Main St, Memphis, TN 38103")).toBe("38103");
    expect(zipFromAddress("125 N Main St, Memphis, TN 38103-1234, USA")).toBe("38103");
    expect(zipFromAddress("12345 Main St, Memphis, TN")).toBeNull();
    expect(zipFromAddress("38103")).toBe("38103");
    expect(normalizeAddress("  125 n main\nst ")).toBe("125 N MAIN ST");
  });
  it("parses Census batch rows, including no-match rows without coordinates", () => {
    const parsed = parseCensusBatch(`"0","a",${KNOWN["125 N MAIN ST, MEMPHIS, TN 38103"]}\n"1","b","No_Match"\n"2","c","Tie"\n`);
    expect(parsed.get("0")).toMatchObject({ match: "exact", lat: 35.148562911373, lon: -90.05155413782 });
    expect(parsed.get("1")).toMatchObject({ match: null, lat: null, status: "No_Match" });
    expect(parsed.get("2")).toMatchObject({ match: null, status: "Tie" });
  });
});

describe("resolving a scenario", () => {
  const doc = () => scenario([
    { address: "125 N Main St, Memphis, TN 38103" },
    { address: "1600 Pennsylvania Ave, Washington, DC 20500" },
    { address: "1 Nowhere Rd, Memphis, TN 38103" }, // no Census match → ZCTA internal point
    { address: "PO Box 5, Somewhere, TX 99999" }, // ZIP with no ZCTA → unresolved
    { address: "No zip here" },
    { lat: 36, lon: -89, coordinate_source: "imported", address: "125 N Main St, Memphis, TN 38103" },
    { lat: 36.5, lon: -89.5, coordinate_source: "manual", address: "125 N Main St, Memphis, TN 38103" },
  ]);

  it("matches with Census, falls back to ZCTA with provenance, and leaves the rest unresolved", async () => {
    const { document, report } = await geocodeDocument(store, config, doc(), { fallback: "zcta", regeocode: false });
    const [a, b, c, d, e, f, g] = document.locations;
    expect(a).toMatchObject({ lat: 35.148562911373, lon: -90.05155413782, coordinate_source: "census", geocode: { provider: "census", dataset: "Public_AR_Current", match_type: "exact", matched_address: "125 N MAIN ST, MEMPHIS, TN, 38103" } });
    expect(a.geocode!.response_ref).toMatch(/^[a-f0-9]{64}$/);
    expect(store.sqlite.prepare("SELECT byteLength FROM artifacts WHERE hash=?").get(a.geocode!.response_ref)).toBeTruthy();
    expect(b.geocode!.match_type).toBe("non_exact");
    expect(c).toMatchObject({ lat: 35.153069, lon: -90.056536, coordinate_source: "zcta", geocode: { provider: "zcta", dataset: ZCTA_DATASET, zcta: "38103", match_type: null } });
    for (const loc of [d, e]) expect(loc).toMatchObject({ lat: null, lon: null, coordinate_source: "unresolved" });
    // Supplied coordinates win unless re-geocoding is requested.
    expect(f).toMatchObject({ lat: 36, lon: -89, coordinate_source: "imported" });
    expect(g).toMatchObject({ lat: 36.5, coordinate_source: "manual" });
    expect(report).toMatchObject({ targets: 5, census_exact: 1, census_non_exact: 1, zcta: 1, unresolved: 2, no_zip: 1, zip_without_zcta: 1, requested: 5, batches: 3 });
    expect(requests.map(r => r.length)).toEqual([2, 2, 1]);
    expect(reviewScenario(document).coordinates).toMatchObject({ census: 2, zcta: 1, unresolved: 2, imported: 1, manual: 1 });
  });

  it("reuses cached answers, including no-match answers", async () => {
    await geocodeDocument(store, config, doc(), { fallback: "zcta", regeocode: false });
    requests = [];
    const { report } = await geocodeDocument(store, config, doc(), { fallback: "zcta", regeocode: false });
    expect(requests).toEqual([]);
    expect(report).toMatchObject({ cached: 5, requested: 0, census_exact: 1 });
  });

  it("re-geocodes imported coordinates on request, keeps the original, and never moves manual ones", async () => {
    const { document, report } = await geocodeDocument(store, config, doc(), { fallback: "off", regeocode: true });
    const f = document.locations[5];
    expect(f).toMatchObject({ coordinate_source: "census", lat: 35.148562911373, original: { lat: 36, lon: -89, coordinate_source: "imported", geocode: null } });
    expect(document.locations[6]).toMatchObject({ lat: 36.5, coordinate_source: "manual", original: null });
    // Fallback off: the no-match address stays unresolved even though its ZIP has a ZCTA.
    expect(document.locations[2].coordinate_source).toBe("unresolved");
    expect(report.zcta).toBe(0);
  });

  it("keeps an existing coordinate when re-geocoding finds nothing", async () => {
    const { document, report } = await geocodeDocument(store, config, scenario([{ lat: 1, lon: 2, coordinate_source: "imported", address: "1 Nowhere Rd" }]), { fallback: "zcta", regeocode: true });
    expect(document.locations[0]).toMatchObject({ lat: 1, lon: 2, coordinate_source: "imported", original: null });
    expect(report.kept).toBe(1);
  });

  it("works without Census (ZIP fallback only) and never invents (0, 0)", async () => {
    const { document, report } = await geocodeDocument(store, { ...config, census: null }, doc(), { fallback: "zcta", regeocode: false });
    expect(requests).toEqual([]);
    expect(report).toMatchObject({ census: "off", zcta: 2, unresolved: 3 });
    for (const loc of document.locations) expect(loc.lat === 0 && loc.lon === 0).toBe(false);
  });

  it("geocodes one manual address with the one-line endpoint", async () => {
    expect(await geocodeOneLine(store, config, "125 N Main St, Memphis, TN 38103")).toMatchObject({ coordinate_source: "census", lat: 35.148562911373, geocode: { match_type: null } });
    expect(await geocodeOneLine(store, config, "1 Nowhere Rd, Memphis, TN 38103")).toMatchObject({ coordinate_source: "zcta", geocode: { zcta: "38103" } });
    expect(await geocodeOneLine(store, config, "1 Nowhere Rd, Memphis, TN 38103", "off")).toMatchObject({ coordinate_source: "unresolved", lat: null });
  });
});

describe("geocoding jobs", () => {
  const imported = () => {
    const preview = previewCsvImport({
      name: "Addresses", depot: { id: "d", label: "Depot", lat: 35.1, lon: -90 },
      ordersCsv: 'order_id,order_date,address,product,ordered_pieces,net_value_per_piece,linear_feet_per_piece\nO-1,2026-09-30,"125 N Main St, Memphis, TN 38103",P,1,1.00,1.00\nO-2,2026-09-30,"9 Elm, Memphis, TN 38103",P,1,1.00,1.00\n',
      inventoryCsv: "product,available_pieces\nP,5\n",
    });
    expect(preview.valid).toBe(true);
    expect(preview.document!.locations[0]).toMatchObject({ address: "125 N Main St, Memphis, TN 38103", coordinate_source: "unresolved" });
    return saveScenario(store, { document: preview.document, author: "Importer", metadata, source: { originals: preview.originals } });
  };

  it("saves the result as the next version with the report in its source", async () => {
    const first = imported();
    const job = createGeocodeJob(store, { versionId: first.versionId, options: {}, author: "Geocoder", metadata });
    const done = await runGeocodeJob(store, config, job.id);
    expect(done).toMatchObject({ status: "succeeded", branched: false, report: { census_exact: 1, zcta: 1 }, progress: { done: 2, total: 2 } });
    const saved = scenarioVersion(store, first.scenarioId);
    expect(saved).toMatchObject({ id: done!.resultVersionId, revision: 2, parentVersionId: first.versionId, author: "Geocoder" });
    expect(saved.document.locations.map(l => l.coordinate_source)).toEqual(["census", "zcta"]);
    expect(saved.source.originals.ordersCsv).toContain("125 N Main St");
    expect(saved.source.geocoding[0]).toMatchObject({ job: job.id, report: { zcta: 1 } });
    // The original version is unchanged.
    expect(scenarioVersion(store, first.scenarioId, first.versionId).document.locations[0].coordinate_source).toBe("unresolved");
  });

  it("branches instead of overwriting when the scenario moved on, and fails cleanly", async () => {
    const first = imported();
    const job = createGeocodeJob(store, { versionId: first.versionId, options: {}, author: "Geocoder", metadata });
    const doc = scenarioVersion(store, first.scenarioId).document;
    saveScenario(store, { document: { ...doc, name: "Edited meanwhile" }, author: "Editor", metadata, scenarioId: first.scenarioId, expectedVersionId: first.versionId });
    const done = await runGeocodeJob(store, config, job.id);
    expect(done).toMatchObject({ status: "succeeded", branched: true });
    expect(scenarioVersion(store, first.scenarioId).document.name).toBe("Edited meanwhile");

    const failing = createGeocodeJob(store, { versionId: first.versionId, options: { regeocode: true }, author: "Geocoder", metadata });
    store.sqlite.prepare("DELETE FROM geocode_cache").run();
    const broken = { ...config, fetch: (async () => new Response("down", { status: 503 })) as typeof fetch };
    expect(await runGeocodeJob(store, broken, failing.id)).toMatchObject({ status: "failed", error: "The Census batch geocoder returned HTTP 503." });

    const stale = createGeocodeJob(store, { versionId: first.versionId, options: {}, author: "Geocoder", metadata });
    expect(failInterruptedGeocodeJobs(store)).toBe(1);
    expect(geocodeJob(store, stale.id)!.status).toBe("failed");
  });
});
