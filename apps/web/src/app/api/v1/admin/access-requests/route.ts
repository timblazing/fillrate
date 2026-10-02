import { listAccessRequests, type AccessStatus } from "@fillrate/db/access-requests"
import { principal, requireAdmin } from "@/lib/server/access"
import { initializeDatabase } from "@/lib/server/database"
import { ApiError, errorResponse } from "@/lib/server/errors"

export async function GET(request: Request) {
  try {
    requireAdmin(await principal(request))
    const raw = new URL(request.url).searchParams.get("status")
    if (raw && !["pending", "approved", "denied", "revoked"].includes(raw)) throw new ApiError(400, "invalid_status", "Unknown request status.")
    return Response.json({ requests: listAccessRequests(initializeDatabase(), raw as AccessStatus | undefined) }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return errorResponse(error) }
}
