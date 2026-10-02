import type { TravelSnapshot } from "@fillrate/db/travel";

const INSPECTOR_NODE_LIMIT = 12;

/** A compact, directed sample for the browser; the stored matrix stays server-side. */
export function travelSnapshotPreview(snapshot: TravelSnapshot, id: string) {
  const count = snapshot.nodes.length;
  const sampleCount = Math.min(count, INSPECTOR_NODE_LIMIT);
  let reachable = 0;
  let possible = 0;
  for (let i = 0; i < count; i++) for (let j = 0; j < count; j++) if (i !== j) {
    possible++;
    if (snapshot.distances[i][j] !== null) reachable++;
  }
  return {
    id,
    provider: snapshot.provider,
    providerVersion: snapshot.provider_version,
    datasetRevision: snapshot.dataset_revision,
    profile: snapshot.profile,
    distanceUnits: snapshot.distance_units,
    durationUnits: snapshot.duration_units,
    nodeCount: count,
    warningCount: snapshot.warnings.length,
    reachableEdges: reachable,
    possibleEdges: possible,
    nodes: snapshot.nodes,
    sampleNodes: snapshot.nodes.slice(0, sampleCount),
    distances: snapshot.distances.slice(0, sampleCount).map(row => row.slice(0, sampleCount)),
  };
}
