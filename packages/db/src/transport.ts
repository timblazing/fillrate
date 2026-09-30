// Internal worker transport (spec §12): claim, heartbeat/cancel status, and ordered events
// with atomic artifact completion. It is a separate HTTP server bound to loopback, so the
// public Next.js listener never routes /internal/*. Every request must also come from a
// loopback socket address (never a forwarding header) and carry the worker bearer token.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname } from "node:path";
import type { Lease, WorkerEvent } from "@fillrate/contracts";
import { MAX_COMPLETION_BYTES, type ArtifactInput, type Store } from "./index";

export type WorkerTransportOptions = {
  token: string;
  host?: string;
  port?: number;
  leaseMs?: number;
  now?: () => number;
};
export type WorkerContact = { workerId: string; at: number } | null;

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const MAX_BODY_BYTES = MAX_COMPLETION_BYTES + 4 * 1024 * 1024; // JSON overhead around artifacts
const CONFLICT = new Set(["stale_lease", "event_conflict", "event_out_of_order", "cancel_requested"]);

/** Uses WORKER_TOKEN, else a token file next to the database (created 0600 on first use). */
export function resolveWorkerToken(databasePath: string, env = process.env) {
  if (env.WORKER_TOKEN) return env.WORKER_TOKEN;
  const file = `${dirname(databasePath)}/worker.token`;
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  mkdirSync(dirname(file), { recursive: true });
  const token = randomBytes(32).toString("hex");
  writeFileSync(file, token, { mode: 0o600 });
  chmodSync(file, 0o600);
  return token;
}

export function createWorkerTransport(store: Store, options: WorkerTransportOptions) {
  const expected = Buffer.from(`Bearer ${options.token}`);
  const leaseMs = options.leaseMs ?? 60_000;
  const now = options.now ?? Date.now;
  let contact: WorkerContact = null;

  const server: Server = createServer(async (req, res) => {
    try {
      if (!LOOPBACK.has(req.socket.remoteAddress ?? "")) return send(res, 403, { error: "not_loopback" });
      const auth = Buffer.from(req.headers.authorization ?? "");
      if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) return send(res, 401, { error: "unauthorized" });
      if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
      const body = await readJson(req);
      const route = req.url?.split("?")[0];
      if (route === "/internal/worker/claim") {
        const workerId = String((body as { worker_id?: unknown }).worker_id ?? "");
        contact = { workerId, at: now() };
        const claimed = store.claim(workerId, now(), leaseMs);
        if (!claimed) return send(res, 200, { job: null });
        return send(res, 200, {
          job: {
            lease: claimed.lease,
            run_id: claimed.run.id,
            expires_at: claimed.expiresAt,
            settings: JSON.parse(claimed.run.settings),
            scenario: store.versionDocument(claimed.run.versionId),
          },
        });
      }
      if (route === "/internal/worker/heartbeat") {
        const lease = (body as { lease: Lease }).lease;
        contact = { workerId: lease?.worker_id, at: now() };
        const beat = store.heartbeat(lease, now(), leaseMs);
        return send(res, 200, { cancel_requested: beat.cancelRequested, expires_at: beat.expiresAt });
      }
      if (route === "/internal/worker/events") {
        const { event, artifacts = [] } = body as { event: WorkerEvent; artifacts?: ArtifactInput[] };
        contact = { workerId: event?.lease?.worker_id, at: now() };
        return send(res, 200, store.record(event, artifacts, now()));
      }
      return send(res, 404, { error: "not_found" });
    } catch (error) {
      const code = error instanceof Error ? error.message.split(":")[0] : "error";
      const status = code === "payload_too_large" ? 413 : CONFLICT.has(code) ? 409 : 400;
      return send(res, status, { error: code });
    }
  });

  return {
    server,
    lastContact: () => contact,
    listen: () => new Promise<{ port: number }>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 3100, options.host ?? "127.0.0.1", () => {
        const address = server.address();
        resolve({ port: typeof address === "object" && address ? address.port : 0 });
      });
    }),
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("payload_too_large");
    chunks.push(chunk as Buffer);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new Error("invalid_json");
  }
}
