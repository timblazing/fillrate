import { EXAMPLES, exampleInfo } from "@/lib/server/runs"

// Bundled synthetic scenarios that runs, explorer jobs and sweeps accept as `example`.
export function GET() {
  return Response.json({ examples: Object.values(EXAMPLES).map(exampleInfo) })
}
