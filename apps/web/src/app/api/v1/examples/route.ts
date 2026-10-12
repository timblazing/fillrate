import { EXAMPLES, errorResponse, exampleInfo, parseExample } from "@/lib/server/runs"

// Bundled synthetic scenarios that runs, explorer jobs and sweeps accept as `example`.
// `?id=` returns that example's scenario document and run settings, for opening it in the workbench.
export function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id")
  if (id === null) return Response.json({ examples: Object.values(EXAMPLES).map(exampleInfo) })
  try {
    const { scenario, settings } = parseExample(id, "m1")
    return Response.json({ scenario, settings })
  } catch (error) {
    return errorResponse(error)
  }
}
