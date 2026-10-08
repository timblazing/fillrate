import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

describe("playground caps", () => {
  it("rejects scenarios over the order cap", async () => {
    const { assertWithinCaps } = await import("./server/playground")
    expect(() => assertWithinCaps(2000, 2000)).not.toThrow()
    expect(() => assertWithinCaps(2001, 2000)).toThrow(/up to 2,000 orders/)
  })

  it("clamps per-cluster solver time to 5 seconds", async () => {
    const { clampSettings } = await import("./server/playground")
    expect(clampSettings({ solver_time_limit_s: 10 }).solver_time_limit_s).toBe(5)
    expect(clampSettings({ solver_time_limit_s: 2 }).solver_time_limit_s).toBe(2)
  })
})
