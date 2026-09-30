import "server-only"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { DOC_PATHS, parseProjectDocs, type DocSources } from "@/lib/project-docs"

// Reads the planning docs for /dev at build time (the page is static; docs are not in the runtime image).
// The browser then refreshes them from GitHub `main`; see app/dev/progress-view.tsx.

function repoRoot(): string {
  let dir = /*turbopackIgnore: true*/ process.cwd()
  while (!existsSync(join(/*turbopackIgnore: true*/ dir, "fillrate-technical-spec.md"))) {
    const parent = dirname(dir)
    if (parent === dir) throw new Error("fillrate-technical-spec.md not found above " + process.cwd())
    dir = parent
  }
  return dir
}

function read(path: string): string {
  return readFileSync(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ repoRoot(), path), "utf8")
}

export function loadProjectDocs() {
  const sources = Object.fromEntries(Object.entries(DOC_PATHS).map(([key, path]) => [key, read(path)])) as DocSources
  return parseProjectDocs(sources)
}
