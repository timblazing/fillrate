import { randomUUID } from "node:crypto";
import { AdmissionError, type Store } from "./index";

export type AccessStatus = "pending" | "approved" | "denied" | "revoked";
export type AccessAction = "approve" | "deny" | "revoke" | "restore";
type RequestRow = { userId: string; status: AccessStatus; note: string | null; requestedAt: number; decidedAt: number | null; updatedAt: number };

/** The GitHub account link, not mutable profile data, is the sole admin identity. */
export function isAdmin(store: Store, userId: string, githubId: string) {
  return !!store.sqlite.prepare("SELECT 1 FROM account WHERE user_id=? AND provider_id='github' AND account_id=?").get(userId, githubId);
}

export function accessFor(store: Store, userId: string, githubId: string, signupMode: "request" | "open") {
  const admin = isAdmin(store, userId, githubId);
  const now = Date.now();
  // An existing pre-migration account was backfilled approved. New accounts are inserted once on first request.
  store.sqlite.prepare("INSERT OR IGNORE INTO access_requests (user_id,status,requested_at,updated_at) VALUES (?,?,?,?)")
    .run(userId, admin || signupMode === "open" ? "approved" : "pending", now, now);
  const row = store.sqlite.prepare("SELECT user_id AS userId,status,note,requested_at AS requestedAt,decided_at AS decidedAt,updated_at AS updatedAt FROM access_requests WHERE user_id=?")
    .get(userId) as RequestRow;
  // Admin configuration is authoritative even if an old row was changed before this identity became admin.
  return { ...row, status: admin ? "approved" as const : row.status, admin,
    canRetry: row.status === "denied" && !!row.decidedAt && now - row.decidedAt >= 7 * 86_400_000 };
}

export function saveAccessNote(store: Store, userId: string, note: string) {
  if (note.length > 500) throw new Error("note_too_long");
  return store.sqlite.transaction(() => {
    const row = store.sqlite.prepare("SELECT status,decided_at AS decidedAt FROM access_requests WHERE user_id=?").get(userId) as { status: AccessStatus; decidedAt: number | null } | undefined;
    if (!row || !["pending", "denied"].includes(row.status)) throw new Error("invalid_access_transition");
    const now = Date.now();
    if (row.status === "denied" && (!row.decidedAt || now - row.decidedAt < 7 * 86_400_000)) throw new Error("rerequest_wait");
    const rate = store.spendRate(`access-note:user:${userId}`, 1, 10, 86_400_000, now);
    if (!rate.ok) throw new AdmissionError("quota_exceeded", "You can update an access request at most ten times per day.", rate.retryAfterMs);
    store.sqlite.prepare("UPDATE access_requests SET note=?,status='pending',requested_at=?,decided_at=NULL,decided_by=NULL,updated_at=? WHERE user_id=?")
      .run(note, row.status === "denied" ? now : (store.sqlite.prepare("SELECT requested_at FROM access_requests WHERE user_id=?").get(userId) as { requested_at: number }).requested_at, now, userId);
    return { status: "pending" as const, note };
  }).immediate();
}

export function listAccessRequests(store: Store, status?: AccessStatus) {
  const where = status ? "WHERE ar.status=?" : "";
  return store.sqlite.prepare(`SELECT ar.user_id AS userId, ar.status, ar.note, ar.requested_at AS requestedAt, ar.decided_at AS decidedAt,
    u.name, u.email, u.image, a.account_id AS githubId,
    (SELECT count(*) FROM scenarios s WHERE s.ownerId='user:' || u.id) AS scenarios,
    (SELECT count(*) FROM runs r WHERE r.ownerId='user:' || u.id) AS runs
    FROM access_requests ar JOIN user u ON u.id=ar.user_id
    LEFT JOIN account a ON a.user_id=u.id AND a.provider_id='github'
    ${where} ORDER BY ar.requested_at DESC, ar.user_id DESC`).all(...(status ? [status] : []));
}

export function decideAccess(store: Store, adminId: string, userId: string, action: AccessAction, adminGithubId: string) {
  return store.sqlite.transaction(() => {
    if (isAdmin(store, userId, adminGithubId)) throw new Error("admin_immutable");
    const row = store.sqlite.prepare("SELECT status FROM access_requests WHERE user_id=?").get(userId) as { status: AccessStatus } | undefined;
    if (!row) throw new Error("access_request_not_found");
    const transitions: Record<AccessAction, AccessStatus[]> = { approve: ["pending"], deny: ["pending"], revoke: ["approved"], restore: ["revoked", "denied"] };
    if (!transitions[action].includes(row.status)) throw new Error("invalid_access_transition");
    const status: AccessStatus = action === "approve" || action === "restore" ? "approved" : action === "deny" ? "denied" : "revoked";
    const now = Date.now();
    store.sqlite.prepare("UPDATE access_requests SET status=?,decided_at=?,decided_by=?,updated_at=? WHERE user_id=?").run(status, now, adminId, now, userId);
    if (action === "revoke") {
      const runs = store.sqlite.prepare("SELECT r.id FROM runs r JOIN jobs j ON j.runId=r.id WHERE r.ownerId=? AND j.status NOT IN ('succeeded','failed','cancelled','interrupted')")
        .all(`user:${userId}`) as { id: string }[];
      for (const run of runs) store.cancel(run.id);
      store.sqlite.prepare("UPDATE geocode_jobs SET status='cancelled', updatedAt=? WHERE ownerId=? AND status IN ('queued','running')").run(now, `user:${userId}`);
    }
    store.sqlite.prepare("INSERT INTO admin_events (id,admin_id,user_id,action,created_at) VALUES (?,?,?,?,?)").run(randomUUID(), adminId, userId, action, now);
    return status;
  }).immediate();
}
