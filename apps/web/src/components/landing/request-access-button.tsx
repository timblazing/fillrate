"use client"

import { ArrowRight } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { toastManager } from "@/components/ui/toast"
import { signInWithGitHub, type Me } from "@/lib/client/auth-client"

export function RequestAccessButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  async function requestAccess() {
    setPending(true)
    try {
      const response = await fetch("/api/v1/me", { cache: "no-store" })
      if (!response.ok) throw new Error("Could not start your access request. Please try again.")
      const me: Me = await response.json()
      if (me.mode !== "hosted" || me.kind === "user" || me.kind === "operator") {
        router.push("/scenarios")
      } else if (me.user) {
        router.push("/request-access")
      } else {
        await signInWithGitHub("/request-access")
      }
    } catch (error) {
      toastManager.add({ type: "error", title: "Request access failed", description: (error as Error).message })
      setPending(false)
    }
  }
  return (
    <Button size="lg" className="h-11 gap-3 rounded-full pr-2 pl-5 text-sm" loading={pending} onClick={requestAccess}>
      Get started
      <span className="bg-primary-foreground/10 flex size-7 items-center justify-center rounded-full">
        <ArrowRight aria-hidden="true" className="size-3.5" />
      </span>
    </Button>
  )
}
