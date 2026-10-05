"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { toastManager } from "@/components/ui/toast"
import { authClient } from "@/lib/client/auth-client"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { DeleteAccountButton } from "../(app)/account/account-actions"

export function RequestForm({ name, email, image, status, note, canRetry }: { name: string; email: string; image: string | null; status: "pending" | "approved" | "denied" | "revoked"; note: string; canRetry: boolean }) {
  const [value, setValue] = useState(note)
  const [busy, setBusy] = useState(false)
  const router = useRouter()
  async function submit() {
    setBusy(true)
    try {
      const response = await fetch("/api/v1/me/access-request", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ note: value }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error?.message ?? "Request failed.")
      toastManager.add({ type: "success", title: status === "denied" ? "Request sent" : "Request saved" })
      router.refresh()
    } catch (error) { toastManager.add({ type: "error", title: "Request not saved", description: (error as Error).message }) }
    finally { setBusy(false) }
  }
  return <div className="space-y-5 rounded-xl border p-5">
    <div className="flex items-center gap-3"><Avatar className="size-10">{image && <AvatarImage src={image} alt="" />}<AvatarFallback>{name.slice(0, 1)}</AvatarFallback></Avatar><div className="min-w-0"><p className="truncate font-medium">{name}</p><p className="text-muted-foreground truncate text-sm">{email}</p></div></div>
    <p className="text-sm">Status: <strong className="capitalize">{status}</strong></p>
    {status === "denied" && <p className="text-muted-foreground text-sm">Your request was declined. You can request again seven days after that decision.</p>}
    {status === "revoked" && <p className="text-muted-foreground text-sm">Your access was removed. Your data is kept and you can delete your account.</p>}
    {(status === "pending" || canRetry) && <div className="space-y-2"><label htmlFor="request-note" className="text-sm font-medium">What will you use Fillrate for? (optional)</label><textarea id="request-note" maxLength={500} value={value} onChange={e => setValue(e.target.value)} className="bg-background min-h-28 w-full rounded-md border p-3 text-sm" /><p className="text-muted-foreground text-right text-xs">{value.length}/500</p><Button loading={busy} onClick={submit}>{note || status === "denied" ? "Update request" : "Submit request"}</Button></div>}
    <div><Button variant="outline" onClick={async () => { await authClient.signOut(); router.push("/"); router.refresh() }}>Sign out</Button></div>
    {status === "revoked" && <div className="border-t pt-4"><DeleteAccountButton /></div>}
  </div>
}
