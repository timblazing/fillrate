"use client"

import { createAuthClient } from "better-auth/react"

// Same-origin Better Auth client (hosted mode). In local and operator modes the /api/auth routes answer 404
// and nothing calls this.
export const authClient = createAuthClient()

export type Me = {
  mode: "hosted" | "local" | "operator"
  kind: "local" | "operator" | "user" | "anonymous"
  user: { id: string; name: string; email: string; image: string | null } | null
  owner: boolean
}

export async function signInWithGitHub(callbackURL = window.location.pathname + window.location.search) {
  await authClient.signIn.social({ provider: "github", callbackURL })
}
