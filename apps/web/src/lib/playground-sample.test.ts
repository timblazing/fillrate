import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { parseContract } from "@fillrate/contracts"
import { describe, expect, it } from "vitest"

import artifact from "../../../../examples/playground-result.json"

const root = resolve(import.meta.dirname, "../../../..")
const hash = (content: string | Buffer) => createHash("sha256").update(content).digest("hex")

describe("bundled playground plan", () => {
  it("matches the current scenario and optimizer sources", () => {
    expect(artifact.scenario_sha256).toBe(hash(readFileSync(resolve(root, "examples/lesson-fulfillment.json"))))
    const optimizer = resolve(root, "services/optimizer")
    const source = resolve(optimizer, "src/fillrate_optimizer")
    const files = [resolve(optimizer, "uv.lock"), ...readdirSync(source).filter(name => name.endsWith(".py")).sort().map(name => resolve(source, name))]
    expect(artifact.optimizer_sha256).toBe(hash(Buffer.concat(files.map(file => readFileSync(file)))))
  })

  it("contains a complete, independently validated real plan", () => {
    const summary = parseContract("RunSummary", artifact.summary)
    expect(summary.validity).toBe("valid")
    expect(summary.coverage).toBe("complete")
    expect(summary.trucks.length).toBeGreaterThan(0)
    expect(summary.settings.solver_time_limit_s).toBe(5)
    expect(summary.products.every(product => product.allocated_unplanned === 0)).toBe(true)
  })
})
