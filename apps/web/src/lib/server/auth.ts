import "server-only"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { deploymentMode, type DeploymentMode } from "@fillrate/db/hosted"
import { account, session, user, verification } from "@fillrate/db/schema"

import { initializeDatabase } from "./database"

// The deployment mode is read once per process; a bad configuration throws here and at startup
// (instrumentation.ts), so a hosted server never answers with auth silently switched off.
const state = globalThis as typeof globalThis & { fillrateMode?: DeploymentMode; fillrateAuth?: ReturnType<typeof createAuth> }

export function mode(): DeploymentMode {
  return (state.fillrateMode ??= deploymentMode(process.env))
}

function createAuth(config: Extract<DeploymentMode, { mode: "hosted" }>) {
  return betterAuth({
    appName: "Fillrate",
    baseURL: config.auth.baseURL,
    secret: config.auth.secret,
    trustedOrigins: [config.auth.origin],
    database: drizzleAdapter(initializeDatabase().db, { provider: "sqlite", schema: { user, session, account, verification } }),
    // GitHub only: no password, reset or email delivery service to run (spec §14).
    emailAndPassword: { enabled: false },
    socialProviders: { github: { clientId: config.auth.github.clientId, clientSecret: config.auth.github.clientSecret } },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    advanced: {
      useSecureCookies: config.auth.baseURL.startsWith("https:"),
      // Forwarded headers are spoofable; only the header the operator's proxy overwrites is read.
      ipAddress: config.trustedIpHeader ? { ipAddressHeaders: [config.trustedIpHeader] } : { disableIpTracking: true },
    },
    rateLimit: { enabled: true, window: 60, max: 30 },
    telemetry: { enabled: false },
  })
}

/** The Better Auth instance; hosted mode only. */
export function hostedAuth() {
  const current = mode()
  if (current.mode !== "hosted") throw new Error("hosted_auth_unavailable")
  return (state.fillrateAuth ??= createAuth(current))
}
