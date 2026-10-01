import { principal } from "@/lib/server/access"
import { initializeDatabase } from "@/lib/server/database"
import { previewSweep } from "@/lib/server/experiments"
import { errorResponse } from "@/lib/server/runs"
import { boundedJson } from "@/lib/server/scenarios"

export const dynamic = "force-dynamic"

// Expanded run count and budget before anything is enqueued (spec §9).
export async function POST(request: Request) {
  try {
    const who = await principal(request)
    return Response.json(previewSweep(initializeDatabase(), who, (await boundedJson(request)) ?? {}), { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return errorResponse(error)
  }
}
