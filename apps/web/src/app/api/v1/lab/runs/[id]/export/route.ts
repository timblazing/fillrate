import { accessError, assertRunRead, principal } from "@/lib/server/access"
import { initializeDatabase } from "@/lib/server/database"
import { labExportResponse } from "@/lib/server/lab"
import { ApiError, errorResponse } from "@/lib/server/runs"

export const dynamic = "force-dynamic"

// ?format=json (default): the instance, validated result and run provenance. ?format=python: a reproduction script
// that re-solves the instance with the pinned optimizer and checks the recorded outcome.
export async function GET(request: Request, ctx: RouteContext<"/api/v1/lab/runs/[id]/export">) {
  try {
    const { id } = await ctx.params
    const who = await principal(request)
    if (who.kind === "pending") throw accessError(who)
    const store = initializeDatabase()
    if (assertRunRead(store, who, id).kind !== "lab") throw new ApiError(404, "run_not_found", "No lab run with this ID.")
    return labExportResponse(store, id, new URL(request.url).searchParams.get("format") ?? "json")
  } catch (error) {
    return errorResponse(error)
  }
}
