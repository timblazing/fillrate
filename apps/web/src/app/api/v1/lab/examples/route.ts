import { LAB_EXAMPLES, labExampleInfo } from "@/lib/server/lab"

// Bundled Solver Lab instances (synthetic, public), with the observations their tests assert.
export function GET() {
  return Response.json({ examples: Object.values(LAB_EXAMPLES).map(example => ({ ...labExampleInfo(example), instance: example.instance })) })
}
