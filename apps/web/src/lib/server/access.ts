import "server-only"
import { timingSafeEqual } from "node:crypto"
import { headers } from "next/headers"
import { EXAMPLES_OWNER, PUBLIC_OWNER, type Admission, type Store } from "@fillrate/db"
import { clientIp, DAY_MS, quotaConfig } from "@fillrate/db/hosted"

import { hostedAuth, mode } from "./auth"
import { ApiError } from "./errors"

// Who is asking (spec §14). Authorization lives here and in the store's queries, never in browser IDs or
// UI visibility. `ownerId` is the dataset the principal may read and write: "operator" for local mode and
// the operator key, "user:<id>" for a hosted account, null for anonymous callers (bundled examples only).
export type Principal = {
  kind: "local" | "operator" | "user" | "anonymous"
  ownerId: string | null
  /** May start synthetic runs without spending the anonymous public budget. */
  runKey: boolean
  user: { id: string; name: string; email: string; image: string | null } | null
  ip: string | null
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"])

export const quotas = () => quotaConfig(process.env, mode().mode)

function keyMatches(given: string, expected: string | undefined) {
  if (!expected) return false
  const a = Buffer.from(given), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function cookie(headers: Headers, name: string) {
  const raw = headers.get("cookie")?.split(";").map(x => x.trim()).find(x => x.startsWith(`${name}=`))?.slice(name.length + 1)
  return raw ? decodeURIComponent(raw) : ""
}

/** Resolves the caller from a route request or a page's `headers()`. */
export async function principal(source: Request | Headers): Promise<Principal> {
  const request = source instanceof Request ? source : null
  const headers = request ? request.headers : (source as Headers)
  const current = mode()
  const ip = clientIp(headers, current.trustedIpHeader)
  const runKeyGiven = headers.get("x-run-key") ?? (request ? new URL(request.url).searchParams.get("key") : null) ?? ""
  const scenarioKey = headers.get("x-scenario-key") ?? cookie(headers, "fillrate_operator")
  const operator: Principal = { kind: "operator", ownerId: "operator", runKey: true, user: null, ip }

  if (current.mode === "local") return { kind: "local", ownerId: "operator", runKey: true, user: null, ip: null }
  if (current.mode === "operator" && process.env.NODE_ENV !== "production") return operator

  if (current.mode === "hosted" && request && UNSAFE.has(request.method)) {
    // Session cookies are SameSite=Lax; refuse any cross-origin write outright as well.
    const origin = headers.get("origin")
    if (origin && origin !== current.auth.origin) throw new ApiError(403, "cross_origin", "Cross-origin requests are not accepted.")
  }
  if (keyMatches(scenarioKey, process.env.SCENARIO_KEY)) return operator
  const runKey = keyMatches(runKeyGiven, process.env.RUN_KEY)
  if (current.mode === "hosted") {
    const found = await hostedAuth().api.getSession({ headers })
    if (found?.user) {
      const u = found.user
      return { kind: "user", ownerId: `user:${u.id}`, runKey: false, user: { id: u.id, name: u.name, email: u.email, image: u.image ?? null }, ip }
    }
  }
  return { kind: "anonymous", ownerId: null, runKey, user: null, ip }
}

/** The caller of a server-rendered page. */
export async function pagePrincipal() {
  return principal(await headers())
}

/** The dataset a principal works in, or the reason it has none. */
export function requireOwner(who: Principal) {
  if (who.ownerId) return who.ownerId
  const current = mode().mode
  if (current === "hosted") throw new ApiError(401, "sign_in_required", "Sign in to import, save and run your own scenarios.")
  if (!process.env.SCENARIO_KEY) throw new ApiError(503, "scenarios_disabled", "Scenario access is not enabled on this server.")
  throw new ApiError(403, "forbidden", "A valid scenario key is required.")
}

export const canReadOwner = (who: Principal, ownerId: string) => ownerId === EXAMPLES_OWNER || (who.ownerId !== null && ownerId === who.ownerId)

function versionOwner(store: Store, versionId: string) {
  try { return store.versionOwner(versionId) } catch { return null }
}

/** Bundled examples are public; anything else needs its owner. Missing and forbidden look the same. */
export function assertVersionRead(store: Store, who: Principal, versionId: string, notFound = new ApiError(404, "version_not_found", "No saved scenario version with this ID.")) {
  const owner = versionOwner(store, versionId)
  if (!owner || !canReadOwner(who, owner)) throw notFound
  return owner
}

/** A saved (imported) version the principal owns; bundled examples are not editable scenarios. */
export function assertOwnVersion(store: Store, who: Principal, versionId: unknown) {
  const ownerId = requireOwner(who)
  const missing = new ApiError(404, "version_not_found", "No saved imported scenario version.")
  if (typeof versionId !== "string" || versionOwner(store, versionId) !== ownerId) throw missing
  return ownerId
}

export function assertRunRead(store: Store, who: Principal, runId: string) {
  const view = store.runView(runId)
  const missing = new ApiError(404, "run_not_found", "No run with this ID.")
  if (!view) throw missing
  assertVersionRead(store, who, view.versionId, missing)
  return view
}

/** Cancelling: the submitter, or for anonymous public runs the run key / operator. */
export function canCancel(who: Principal, runOwner: string) {
  if (who.ownerId && runOwner === who.ownerId) return true
  return runOwner === PUBLIC_OWNER && who.runKey
}

const day = (bucket: string, limit: number, label: string) => ({ bucket, limit, windowMs: DAY_MS, label })

/** Account limits for one hosted user's submission; the operator and local mode keep only the global queue bound. */
export function admission(who: Principal): Admission {
  const q = quotas()
  if (who.kind !== "user") return { ownerId: who.ownerId ?? PUBLIC_OWNER, maxQueued: q.maxQueued }
  return {
    ownerId: who.ownerId!, maxActive: q.activeJobs, maxQueued: q.maxQueued,
    buckets: [day(`solves:${who.ownerId}`, q.solvesPerDay, "daily solve admissions"), ...(who.ip ? [day(`solves:ip:${who.ip}`, q.ipSolvesPerDay, "daily solve admissions from this network")] : [])],
  }
}

/**
 * Synthetic submissions on the bundled examples. Accounts, the operator, local mode and the run key go through
 * `admission`; anonymous callers only when PUBLIC_SYNTHETIC_RUNS=1, against a global hourly/daily budget.
 */
export function syntheticAdmission(who: Principal): { ownerId: string; admission: Admission } {
  if (who.ownerId || who.runKey) return { ownerId: who.ownerId ?? PUBLIC_OWNER, admission: admission(who) }
  if (process.env.PUBLIC_SYNTHETIC_RUNS !== "1") {
    if (mode().mode === "hosted") throw new ApiError(401, "sign_in_required", "Sign in to start runs.")
    if (!process.env.RUN_KEY) throw new ApiError(503, "runs_disabled", "Run submission is not enabled on this server.")
    throw new ApiError(403, "forbidden", "A valid run key is required.")
  }
  const q = quotas()
  return {
    ownerId: PUBLIC_OWNER,
    admission: {
      ownerId: PUBLIC_OWNER, maxQueued: q.maxQueued,
      buckets: [
        { bucket: "public:hour", limit: q.publicRunsPerHour, windowMs: 3_600_000, label: "hourly public runs" },
        day("public:day", q.publicRunsPerDay, "daily public runs"),
        ...(who.ip ? [day(`solves:ip:${who.ip}`, q.ipSolvesPerDay, "daily solve admissions from this network")] : []),
      ],
    },
  }
}

/** Non-solve work for a hosted account (geocoding, lookups, saves, uploads): one daily bucket, plus the active limit when it queues a job. */
export function workAdmission(who: Principal, kind: "geocode" | "lookup" | "save" | "upload"): Admission | undefined {
  if (who.kind !== "user") return undefined
  const q = quotas()
  const [limit, label] = {
    geocode: [q.geocodeJobsPerDay, "daily geocoding jobs"],
    lookup: [q.addressLookupsPerDay, "daily address lookups"],
    save: [q.savesPerDay, "daily scenario saves"],
    upload: [q.uploadsPerDay, "daily travel snapshot uploads"],
  }[kind] as [number, string]
  return { ownerId: who.ownerId!, ...(kind === "geocode" ? { maxActive: q.activeJobs } : {}), buckets: [day(`${kind}:${who.ownerId}`, limit, label)] }
}

/** Quota status for the account page and `GET /api/v1/me`. */
export function usage(store: Store, who: Principal) {
  if (who.kind !== "user") return null
  const q = quotas(), owner = who.ownerId!
  const read = (kind: string, limit: number) => ({ ...store.rateUsage(`${kind}:${owner}`, DAY_MS), limit })
  return {
    active: { used: store.activeSubmissions(owner), limit: q.activeJobs },
    solves: read("solves", q.solvesPerDay),
    geocode: read("geocode", q.geocodeJobsPerDay),
    lookups: read("lookup", q.addressLookupsPerDay),
    saves: read("save", q.savesPerDay),
    uploads: read("upload", q.uploadsPerDay),
    upload_bytes: q.uploadBytes,
    max_sweep_runs: q.maxSweepRuns,
  }
}
