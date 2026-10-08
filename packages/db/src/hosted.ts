// Deployment mode and admission limits (spec §14, v1.10). Pure functions of the environment, so the web
// server, its startup check and the tests read the same rules.
//
// FILLRATE_MODE=hosted  Better Auth accounts (GitHub). Incomplete auth configuration refuses to start; it never
//                       falls back to an open mode. The operator key still reaches the operator dataset.
// FILLRATE_MODE=local   One account-free dataset (owner "operator"); no keys, users or sessions. Bind to loopback.
// unset                 The pre-account operator deployment: open in development, RUN_KEY / SCENARIO_KEY in production.

export type HostedAuthConfig = { secret: string; baseURL: string; origin: string; github: { clientId: string; clientSecret: string } };
export type DeploymentMode =
  | { mode: "hosted"; auth: HostedAuthConfig; trustedIpHeader: string | null; adminGithubId: string; signupMode: "request" | "open" }
  | { mode: "local"; trustedIpHeader: null }
  | { mode: "operator"; trustedIpHeader: string | null };

export class ModeConfigError extends Error {
  constructor(readonly problems: string[]) { super(`Fillrate configuration refused: ${problems.join("; ")}`); }
}

type Env = Record<string, string | undefined>;
const AUTH_VARS = ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"] as const;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function deploymentMode(env: Env): DeploymentMode {
  const raw = env.FILLRATE_MODE?.trim() ?? "";
  const header = trustedIpHeader(env);
  if (raw === "local") return { mode: "local", trustedIpHeader: null };
  if (raw === "") {
    const set = AUTH_VARS.filter(name => env[name]);
    // Auth settings without a mode look like a hosted deployment that forgot to say so; never guess.
    if (set.length) throw new ModeConfigError([`${set.join(", ")} set but FILLRATE_MODE is not; set FILLRATE_MODE=hosted (or local)`]);
    return { mode: "operator", trustedIpHeader: header };
  }
  if (raw !== "hosted") throw new ModeConfigError([`FILLRATE_MODE must be hosted or local, not "${raw}"`]);

  const problems: string[] = [];
  const secret = env.BETTER_AUTH_SECRET ?? "";
  if (secret.length < 32) problems.push("BETTER_AUTH_SECRET must be at least 32 characters (for example `openssl rand -base64 32`)");
  let url: URL | null = null;
  try { url = new URL(env.BETTER_AUTH_URL ?? ""); } catch { problems.push("BETTER_AUTH_URL must be the canonical site URL, such as https://fillrate.example.com"); }
  if (url) {
    const devLoopback = url.protocol === "http:" && LOOPBACK.has(url.hostname) && env.NODE_ENV !== "production";
    if (url.protocol !== "https:" && !devLoopback) problems.push("BETTER_AUTH_URL must use https (plain http is accepted only for localhost in development)");
    if (url.pathname !== "/" || url.search || url.hash) problems.push("BETTER_AUTH_URL must be an origin without a path");
  }
  if (!env.GITHUB_CLIENT_ID) problems.push("GITHUB_CLIENT_ID is required");
  if (!env.GITHUB_CLIENT_SECRET) problems.push("GITHUB_CLIENT_SECRET is required");
  if (!/^[1-9][0-9]*$/.test(env.ADMIN_GITHUB_ID ?? "")) problems.push("ADMIN_GITHUB_ID must be a positive numeric GitHub user ID");
  const signupMode = env.SIGNUP_MODE ?? "request";
  if (signupMode !== "request" && signupMode !== "open") problems.push("SIGNUP_MODE must be request or open");
  if (problems.length) throw new ModeConfigError(problems);
  return {
    mode: "hosted", trustedIpHeader: header, adminGithubId: env.ADMIN_GITHUB_ID!, signupMode: signupMode as "request" | "open",
    auth: { secret, baseURL: url!.origin, origin: url!.origin, github: { clientId: env.GITHUB_CLIENT_ID!, clientSecret: env.GITHUB_CLIENT_SECRET! } },
  };
}

/** Only a header the reverse proxy overwrites is trusted, and only when the operator names it. */
function trustedIpHeader(env: Env) {
  const name = env.TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase();
  if (!name) return null;
  if (!/^[a-z0-9-]{1,64}$/.test(name)) throw new ModeConfigError(["TRUSTED_CLIENT_IP_HEADER must be a header name such as x-forwarded-for"]);
  return name;
}

/** The client address the trusted proxy recorded: the last (nearest-proxy) entry, or null. */
export function clientIp(headers: Headers, header: string | null) {
  if (!header) return null;
  const value = headers.get(header)?.split(",").at(-1)?.trim() ?? "";
  return /^[0-9a-fA-F:.]{2,45}$/.test(value) ? value : null;
}

export const DAY_MS = 86_400_000;

/**
 * Starting limits (spec §14), each overridable by environment. Tune against target-hardware evidence before
 * opening public signup. Hosted mode defaults to the smaller global queue and sweep sizes.
 */
export function quotaConfig(env: Env, mode: DeploymentMode["mode"]) {
  const int = (name: string, fallback: number) => {
    const value = Number(env[name]);
    return env[name] !== undefined && env[name] !== "" && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
  };
  const hosted = mode === "hosted";
  return {
    activeJobs: int("QUOTA_ACTIVE_JOBS", 1),
    maxQueued: int("MAX_QUEUED_RUNS", hosted ? 10 : 50),
    maxSweepRuns: int("MAX_SWEEP_RUNS", hosted ? 10 : 25),
    solvesPerDay: int("QUOTA_SOLVES_PER_DAY", 20),
    ipSolvesPerDay: int("QUOTA_IP_SOLVES_PER_DAY", 60),
    geocodeJobsPerDay: int("QUOTA_GEOCODE_JOBS_PER_DAY", 10),
    addressLookupsPerDay: int("QUOTA_ADDRESS_LOOKUPS_PER_DAY", 200),
    savesPerDay: int("QUOTA_SAVES_PER_DAY", 100),
    uploadsPerDay: int("QUOTA_UPLOADS_PER_DAY", 20),
    uploadBytes: int("MAX_UPLOAD_BYTES", 10 * 1024 * 1024),
    // Road geometry fetches for inspected trucks: synchronous Valhalla /route calls via the optimizer.
    geometryFetchesPerDay: int("QUOTA_ROUTE_GEOMETRY_PER_DAY", 100),
    publicGeometryFetchesPerHour: int("PUBLIC_ROUTE_GEOMETRY_PER_HOUR", 120),
    publicRunsPerHour: int("PUBLIC_RUNS_PER_HOUR", 60),
    publicRunsPerDay: int("PUBLIC_RUNS_PER_DAY", 300),
  };
}
export type QuotaConfig = ReturnType<typeof quotaConfig>;
