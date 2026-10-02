import { saveAccessNote } from "@fillrate/db/access-requests"
import { principal } from "@/lib/server/access"
import { initializeDatabase } from "@/lib/server/database"
import { ApiError, errorResponse } from "@/lib/server/errors"

export async function PUT(request: Request) {
  try {
    const who = await principal(request)
    if (!who.user) throw new ApiError(401, "sign_in_required", "Sign in to request access.")
    if (who.kind !== "pending" || !["pending", "denied"].includes(who.access ?? "")) throw new ApiError(409, "invalid_access_transition", "This request cannot be updated.")
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ApiError(415, "content_type", "Send JSON.")
    const body: unknown = await request.json()
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof (body as { note?: unknown }).note !== "string") throw new ApiError(400, "invalid_note", "Send a plain text note.")
    const note = (body as { note: string }).note
    if (note.length > 500) throw new ApiError(400, "note_too_long", "The note must be at most 500 characters.")
    return Response.json(saveAccessNote(initializeDatabase(), who.user.id, note), { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    if (error instanceof Error && error.message === "rerequest_wait") error = new ApiError(409, "rerequest_wait", "You can request again seven days after a decline.")
    return errorResponse(error)
  }
}
