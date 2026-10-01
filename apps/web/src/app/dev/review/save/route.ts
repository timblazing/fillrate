import { initializeDatabase } from "@/lib/server/database"
import { parseAnswers, reviewAccess } from "@/lib/server/review"

// Autosave and submit for /dev/review. One row per reviewer browser id.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { id?: unknown; reviewer?: unknown; answers?: unknown; submit?: unknown; key?: unknown } | null
  const access = reviewAccess(typeof body?.key === "string" ? body.key : null)
  if (access === "unconfigured") return Response.json({ error: "Saving is not configured on this server." }, { status: 503 })
  if (access === "denied") return Response.json({ error: "This review link is missing its key." }, { status: 403 })
  if (!body || typeof body.id !== "string" || typeof body.reviewer !== "string") return Response.json({ error: "Invalid request." }, { status: 400 })
  try {
    const answers = parseAnswers(body.answers)
    const saved = initializeDatabase().saveReview(body.id, body.reviewer.trim().slice(0, 200), answers, body.submit === true)
    return Response.json(saved)
  } catch (error) {
    const code = error instanceof Error ? error.message : "error"
    return Response.json({ error: `Could not save (${code}).` }, { status: 400 })
  }
}
