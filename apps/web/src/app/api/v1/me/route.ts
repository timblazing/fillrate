import { principal, usage } from "@/lib/server/access"
import { mode } from "@/lib/server/auth"
import { initializeDatabase } from "@/lib/server/database"
import { ApiError, errorResponse } from "@/lib/server/runs"

export const dynamic = "force-dynamic"

/** Deployment mode, the signed-in account (hosted) and its quota usage. */
export async function GET(request: Request) {
  try {
    const who = await principal(request)
    const store = initializeDatabase()
    const config = mode()
    const pendingCount = who.admin ? (store.sqlite.prepare("SELECT count(*) AS n FROM access_requests WHERE status='pending'").get() as { n: number }).n : 0
    return Response.json({ mode: mode().mode, kind: who.kind, user: who.user, owner: who.ownerId !== null, access: who.access ?? null,
      admin: !!who.admin, signup_mode: config.mode === "hosted" ? config.signupMode : null,
      pending_count: pendingCount, usage: usage(store, who) }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * Deletes the signed-in account and everything it owns: scenarios and their versions, runs, sweeps, geocoding
 * jobs, travel snapshot links, cached geocoder answers, quota records, sessions and the GitHub link. Refused
 * while a job is unfinished. Copies in server backups expire with those backups (docs/hosted-operations.md).
 */
export async function DELETE(request: Request) {
  try {
    const who = await principal(request)
    if (!who.user) throw new ApiError(401, "sign_in_required", "Sign in to delete your account.")
    const store = initializeDatabase()
    let deleted
    try {
      deleted = store.sqlite.transaction(() => {
        const result = store.deleteOwnerData(`user:${who.user!.id}`)
        store.sqlite.prepare("DELETE FROM user WHERE id=?").run(who.user!.id) // sessions and accounts cascade
        return result
      }).immediate()
    } catch (error) {
      if (error instanceof Error && error.message === "active_work") throw new ApiError(409, "active_work", "Cancel your unfinished runs and geocoding jobs, then delete the account.")
      throw error
    }
    const expire = (name: string) => `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${mode().mode === "hosted" && new URL(request.url).protocol === "https:" ? "; Secure" : ""}`
    const headers = new Headers({ "Cache-Control": "private, no-store" })
    for (const name of ["better-auth.session_token", "__Secure-better-auth.session_token", "better-auth.session_data", "__Secure-better-auth.session_data"]) headers.append("Set-Cookie", expire(name))
    return Response.json({ deleted }, { headers })
  } catch (error) {
    return errorResponse(error)
  }
}
