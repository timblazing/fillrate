import { principal, requireOwner } from "@/lib/server/access"
import { initializeDatabase } from "@/lib/server/database"
import { errorResponse, ApiError } from "@/lib/server/runs"
import { snapshotCanonicalJson, snapshotCsv } from "@fillrate/db/travel-export"
import { travelSnapshotPreview } from "@/lib/server/travel-snapshot-preview"
export const dynamic = "force-dynamic"
// Metadata by default (`?inspect=1` adds a sample). `?format=json` downloads the canonical snapshot (its sha256 is the
// identity) and `?format=csv` the long-form directed matrix; both need the owner, like the metadata.
export async function GET(request: Request, context: RouteContext<"/api/v1/travel-snapshots/[id]">) {
  try {
    const ownerId = requireOwner(await principal(request))
    const { id } = await context.params
    const store = initializeDatabase()
    const info = store.travelSnapshotInfo(id, ownerId)
    if (!info) throw new ApiError(404, "travel_snapshot_not_found", "No stored travel snapshot has this identity.")
    const format = new URL(request.url).searchParams.get("format")
    if (format !== null) {
      if (format !== "json" && format !== "csv") throw new ApiError(400, "invalid_format", "format must be json or csv.", ["format"])
      const snapshot = store.travelSnapshot(id)
      const json = format === "json"
      return new Response(json ? snapshotCanonicalJson(snapshot) : snapshotCsv(snapshot), {
        headers: { "Cache-Control": "private, no-store", "content-type": json ? "application/json" : "text/csv; charset=utf-8", "content-disposition": `attachment; filename="fillrate-travel-${id.slice(0, 12)}.${format}"` },
      })
    }
    const result = new URL(request.url).searchParams.get("inspect") === "1"
      ? { ...info, ...travelSnapshotPreview(store.travelSnapshot(id), id) }
      : info
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return errorResponse(error) }
}
