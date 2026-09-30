import { initializeDatabase } from "@/lib/server/database"
import { canUseReview } from "@/lib/server/review"

// Every review response as JSON, for copying into docs/decisions.md.
export async function GET(request: Request) {
  if (!canUseReview(new URL(request.url).searchParams.get("key"))) return Response.json({ error: "Not found." }, { status: 404 })
  return Response.json(initializeDatabase().listReviews(), {
    headers: { "Content-Disposition": `attachment; filename="fillrate-design-review-${new Date().toISOString().slice(0, 10)}.json"` },
  })
}
