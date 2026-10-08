// Direct solves: a run is one HTTP call to the optimizer service (`POST /solve`). Runs go through a single
// in-process queue, one at a time, because the service solves one request at a time anyway.
import { request } from "node:http";
import type { RunFailure, RunResult, Store } from "./index";

export const DEFAULT_OPTIMIZER_URL = "http://127.0.0.1:8000";

type Reply = { status: number; body: unknown };

/** POST JSON with no client-side timeout (a solve can take minutes; the service enforces its own wall limit). */
function postJson(url: string, body: unknown): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "POST", headers: { "content-type": "application/json" } }, res => {
      const chunks: Buffer[] = [];
      res.on("data", chunk => chunks.push(chunk as Buffer));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        try { resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null }); }
        catch { resolve({ status: res.statusCode ?? 0, body: { code: "bad_response", message: text.slice(0, 200) } }); }
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

export function createSolver(store: Store, options: { url?: string } = {}) {
  const url = (options.url ?? process.env.FILLRATE_OPTIMIZER_URL ?? DEFAULT_OPTIMIZER_URL).replace(/\/$/, "");
  let tail: Promise<void> = Promise.resolve();
  let waiting = 0;

  async function solve(runId: string) {
    if (!store.startRun(runId)) return; // cancelled while it waited
    try {
      const reply = await postJson(`${url}/solve`, { ...store.solveInput(runId), solve_id: runId });
      if (reply.status === 200) store.finishRun(runId, { status: "succeeded", result: reply.body as RunResult });
      else if (reply.status === 409) store.finishRun(runId, { status: "cancelled" });
      else {
        const failure = reply.body as Partial<RunFailure> | null;
        store.finishRun(runId, { status: "failed", error: { code: failure?.code ?? `http_${reply.status}`, message: failure?.message ?? "The optimizer service returned an error." } });
      }
    } catch (error) {
      const unreachable = (error as NodeJS.ErrnoException).code === "ECONNREFUSED";
      store.finishRun(runId, { status: "failed", error: { code: unreachable ? "optimizer_unavailable" : "solve_failed", message: unreachable ? `The optimizer service is not running at ${url}.` : error instanceof Error ? error.message : String(error) } });
    }
  }

  return {
    /** True when a run created now would start immediately. */
    idle: () => waiting === 0,
    /** Queues a run created as `queued` (or `running` when `idle()` was true) behind the ones already waiting. Returns when it ends. */
    start(runId: string): Promise<void> {
      waiting++;
      const done = tail.then(() => solve(runId)).finally(() => { waiting--; });
      tail = done.catch(() => undefined);
      return done;
    },
    /** Cancels a queued or running run; a running one is killed in the optimizer service. */
    async cancel(runId: string) {
      const previous = store.cancelRun(runId);
      if (previous === "running") await postJson(`${url}/cancel/${encodeURIComponent(runId)}`, {}).catch(() => undefined);
      return previous !== null;
    },
  };
}
export type Solver = ReturnType<typeof createSolver>;
