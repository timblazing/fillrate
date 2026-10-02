import { principal, requireOwner } from "@/lib/server/access"
import { initializeDatabase } from "@/lib/server/database"
import { errorResponse, ApiError } from "@/lib/server/runs"
import { travelSnapshotPreview } from "@/lib/server/travel-snapshot-preview"
export const dynamic = "force-dynamic"
// Metadata only: the matrix itself is large and is read by the worker through the loopback transport.
export async function GET(request: Request, context: RouteContext<"/api/v1/travel-snapshots/[id]">) {
  try {
    const ownerId = requireOwner(await principal(request))
    const { id } = await context.params
    const store = initializeDatabase()
    const info = store.travelSnapshotInfo(id, ownerId)
    if (!info) throw new ApiError(404, "travel_snapshot_not_found", "No stored travel snapshot has this identity.")
    const result = new URL(request.url).searchParams.get("inspect") === "1"
      ? { ...info, ...travelSnapshotPreview(store.travelSnapshot(id), id) }
      : info
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return errorResponse(error) }
}
