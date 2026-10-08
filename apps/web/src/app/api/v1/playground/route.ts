import type { RunSettings, RunSummary } from "@fillrate/contracts"
import { previewImport, type ImportInput } from "@fillrate/db/imports"
import { DEFAULT_OPTIMIZER_URL, postJson } from "@fillrate/db/solver"
import { randomUUID } from "node:crypto"

import { runDefaults } from "@/lib/run-defaults"
import { ApiError, EXAMPLES, errorResponse } from "@/lib/server/runs"
import { assertWithinCaps, clampSettings, playgroundCaps, playgroundMode } from "@/lib/server/playground"
import { boundedJson } from "@/lib/server/scenarios"

export const dynamic = "force-dynamic"

// The hosted demo's only run endpoint: builds a scenario, solves it directly and returns the summary. Nothing is stored.
let busy = false

function build(body: { example?: unknown; import?: unknown }) {
  if (body.example !== undefined) {
    if (body.example !== "lesson") throw new ApiError(400, "unknown_example", 'Use {"example":"lesson"} or {"import":{…}}.')
    return { scenario: EXAMPLES.lesson.scenario, settings: EXAMPLES.lesson.settings as RunSettings }
  }
  if (!body.import || typeof body.import !== "object") throw new ApiError(400, "invalid_body", 'Send {"example":"lesson"} or {"import":{…}}.')
  const preview = previewImport({ ...(body.import as ImportInput), format: "csv" })
  if (!preview.valid || !preview.document) {
    const first = preview.errors[0]
    throw new ApiError(400, "invalid_import", first ? `${first.file} ${first.row ? `row ${first.row} ` : ""}${first.column}: ${first.message}` : "The CSV files are not valid.")
  }
  const missing = preview.document.locations.filter(l => l.lat == null || l.lon == null).length
  if (missing) throw new ApiError(400, "missing_coordinates", `${missing} location${missing === 1 ? " has" : "s have"} no coordinates. The playground doesn't geocode addresses, so the orders CSV needs latitude and longitude columns on every row.`)
  return { scenario: preview.document, settings: runDefaults as unknown as RunSettings }
}

export async function POST(request: Request) {
  if (!playgroundMode()) return Response.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 })
  try {
    const { scenario, settings } = build((await boundedJson(request)) ?? {})
    const caps = playgroundCaps()
    assertWithinCaps(scenario.orders.length, caps.maxOrders)
    if (busy) throw new ApiError(429, "busy", "Another playground run is in progress, try again in a minute.", [], 60)
    busy = true
    const url = (process.env.FILLRATE_OPTIMIZER_URL ?? DEFAULT_OPTIMIZER_URL).replace(/\/$/, "")
    const solveId = randomUUID()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; void postJson(`${url}/cancel/${solveId}`, {}).catch(() => undefined) }, caps.solveSeconds * 1000)
    try {
      const reply = await postJson(`${url}/solve`, { kind: "pipeline", solve_id: solveId, scenario, settings: clampSettings(settings) })
      if (reply.status === 200) return Response.json({ summary: (reply.body as { summary: RunSummary }).summary }, { headers: { "Cache-Control": "private, no-store" } })
      if (timedOut || reply.status === 409) throw new ApiError(504, "playground_time_limit", `The run took longer than ${caps.solveSeconds} seconds and was stopped. Try fewer orders, or run Fillrate locally.`)
      const failure = reply.body as { code?: string; message?: string } | null
      throw new ApiError(reply.status === 422 ? 422 : 502, failure?.code ?? `http_${reply.status}`, failure?.message ?? "The optimizer service returned an error.")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ECONNREFUSED") throw new ApiError(503, "optimizer_unavailable", "The optimizer service is not running.")
      throw error
    } finally {
      clearTimeout(timer)
      busy = false
    }
  } catch (error) {
    return errorResponse(error)
  }
}
