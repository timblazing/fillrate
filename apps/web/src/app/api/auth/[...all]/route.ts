import { toNextJsHandler } from "better-auth/next-js"

import { hostedAuth, mode } from "@/lib/server/auth"

export const dynamic = "force-dynamic"

// Better Auth (GitHub sign-in, session, sign-out) exists only in hosted mode; elsewhere these routes are absent.
const absent = () => Response.json({ error: { code: "accounts_disabled", message: "Accounts are only available in hosted mode.", fields: [] } }, { status: 404 })
const handler = (method: "GET" | "POST") => (request: Request) => (mode().mode === "hosted" ? toNextJsHandler(hostedAuth())[method](request) : absent())

export const GET = handler("GET")
export const POST = handler("POST")
