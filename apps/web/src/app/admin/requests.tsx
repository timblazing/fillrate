"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs"
import { AlertDialog, AlertDialogClose, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogPopup, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { toastManager } from "@/components/ui/toast"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

type Status = "pending" | "approved" | "denied" | "revoked"
type Action = "approve" | "deny" | "revoke" | "restore"
export type RequestItem = { userId: string; status: Status; note: string | null; requestedAt: number; decidedAt: number | null; name: string; email: string; image: string | null; githubId: string | null; login?: string | null; scenarios: number; runs: number }

export function AdminRequests({ initial }: { initial: RequestItem[] }) {
  const [items, setItems] = useState(initial)
  const [tab, setTab] = useState("pending")
  const [busy, setBusy] = useState<string | null>(null)
  const router = useRouter()
  async function act(row: RequestItem, action: Action) {
    const before = items
    const status: Status = action === "approve" || action === "restore" ? "approved" : action === "deny" ? "denied" : "revoked"
    setItems(current => current.map(item => item.userId === row.userId ? { ...item, status } : item))
    setBusy(row.userId)
    try {
      const response = await fetch(`/api/v1/admin/access-requests/${encodeURIComponent(row.userId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error?.message ?? "Decision failed.")
      toastManager.add({ type: "success", title: `${row.name}: ${status}` })
      router.refresh()
    } catch (error) { setItems(before); toastManager.add({ type: "error", title: "Decision not saved", description: (error as Error).message }) }
    finally { setBusy(null) }
  }
  const visible = items.filter(item => tab === "closed" ? ["denied", "revoked"].includes(item.status) : item.status === tab)
  return <div className="space-y-5"><Tabs value={tab} onValueChange={value => setTab(String(value))}><TabsList><TabsTab value="pending">Pending ({items.filter(x => x.status === "pending").length})</TabsTab><TabsTab value="approved">Approved</TabsTab><TabsTab value="closed">Denied / Revoked</TabsTab></TabsList></Tabs>
    {visible.length === 0 ? <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-sm">No requests here.</p> : <div className="space-y-3">{visible.map(row => <article key={row.userId} className="min-w-0 space-y-3 rounded-xl border p-4">
      <div className="flex min-w-0 items-center gap-3"><Avatar className="size-10">{row.image && <AvatarImage src={row.image} alt="" />}<AvatarFallback>{row.name.slice(0, 1)}</AvatarFallback></Avatar><div className="min-w-0"><p className="truncate font-medium">{row.name}</p><p className="text-muted-foreground truncate text-sm">{row.login ? <a href={`https://github.com/${encodeURIComponent(row.login)}`} target="_blank" rel="noreferrer" className="underline">@{row.login}</a> : row.githubId ? `GitHub ID ${row.githubId}` : "GitHub account"} · {row.email}</p></div></div>
      <p className="text-muted-foreground text-xs">{row.status} · Requested {new Date(row.requestedAt).toLocaleString()}{row.status === "approved" ? ` · ${row.scenarios} scenarios · ${row.runs} runs` : ""}</p>
      {row.note && <p className="whitespace-pre-wrap break-words text-sm">{row.note}</p>}
      <div className="flex flex-wrap gap-2">{row.status === "pending" && <><Button size="sm" loading={busy === row.userId} onClick={() => act(row, "approve")}>Approve</Button><Button size="sm" variant="outline" onClick={() => act(row, "deny")}>Deny</Button></>}
        {row.status === "approved" && <AlertDialog><AlertDialogTrigger render={<Button size="sm" variant="destructive-outline" />}>Revoke</AlertDialogTrigger><AlertDialogPopup><AlertDialogHeader><AlertDialogTitle>Revoke {row.name}?</AlertDialogTitle><AlertDialogDescription>Their unfinished jobs will be cancelled. Their data will be kept.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogClose render={<Button variant="outline" />}>Keep access</AlertDialogClose><AlertDialogClose render={<Button variant="destructive" onClick={() => act(row, "revoke")} />}>Revoke access</AlertDialogClose></AlertDialogFooter></AlertDialogPopup></AlertDialog>}
        {["denied", "revoked"].includes(row.status) && <Button size="sm" onClick={() => act(row, "restore")}>Restore</Button>}</div>
    </article>)}</div>}
  </div>
}
