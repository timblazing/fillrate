import { decideAccess, type AccessAction } from "@fillrate/db/access-requests"
import { principal, requireAdmin } from "@/lib/server/access"
import { mode } from "@/lib/server/auth"
import { initializeDatabase } from "@/lib/server/database"
import { ApiError, errorResponse } from "@/lib/server/errors"

export async function POST(request: Request, context: RouteContext<"/api/v1/admin/access-requests/[userId]">) {
  try {
    const admin = requireAdmin(await principal(request))
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ApiError(415, "content_type", "Send JSON.")
    const body: unknown = await request.json()
    const action = body && typeof body === "object" && !Array.isArray(body) ? (body as { action?: unknown }).action : null
    if (!["approve", "deny", "revoke", "restore"].includes(action as string)) throw new ApiError(400, "invalid_action", "Unknown action.")
    const { userId } = await context.params
    const config = mode()
    if (config.mode !== "hosted") throw new ApiError(404, "not_found", "Not found.")
    const status = decideAccess(initializeDatabase(), admin.id, userId, action as AccessAction, config.adminGithubId)
    console.info(`access decision admin=${admin.id} user=${userId} action=${action}`)
    return Response.json({ userId, status }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    if (error instanceof Error && ["admin_immutable", "invalid_access_transition"].includes(error.message)) error = new ApiError(409, error.message, "That status change is not allowed.")
    if (error instanceof Error && error.message === "access_request_not_found") error = new ApiError(404, "not_found", "Not found.")
    return errorResponse(error)
  }
}
