"use client"

import { Download, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { AlertDialog, AlertDialogClose, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogPopup, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { toastManager } from "@/components/ui/toast"
import { signInWithGitHub } from "@/lib/client/auth-client"

async function send(path: string) {
  const response = await fetch(path, { method: "DELETE", cache: "no-store" })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error?.message ?? "Request failed.")
  return body
}

export function SignInButton() {
  const [pending, setPending] = useState(false)
  return <Button loading={pending} onClick={() => { setPending(true); signInWithGitHub("/account").catch(() => setPending(false)) }}>Sign in with GitHub</Button>
}

export function ExportButton() {
  return <Button variant="outline" render={<a href="/api/v1/me/export" download />}><Download aria-hidden />Download my data</Button>
}

/** Deletes one scenario with its versions, branches, runs and sweeps, after a confirmation. */
export function DeleteScenarioButton({ id, name }: { id: string; name: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  async function remove() {
    setPending(true)
    try { await send(`/api/v1/scenarios/${id}`); toastManager.add({ type: "success", title: `Deleted ${name}` }); router.refresh() }
    catch (error) { toastManager.add({ type: "error", title: "Not deleted", description: (error as Error).message }) }
    finally { setPending(false) }
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button size="sm" variant="ghost" aria-label={`Delete ${name}`} loading={pending} />}><Trash2 aria-hidden /></AlertDialogTrigger>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>Every version, branch, run and sweep of this scenario is deleted now. Server backups keep a copy until they expire.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost" />}>Keep it</AlertDialogClose>
          <AlertDialogClose render={<Button variant="destructive" onClick={remove} />}>Delete scenario</AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  )
}

export function DeleteAccountButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  async function remove() {
    setPending(true)
    try { await send("/api/v1/me"); router.push("/"); router.refresh() }
    catch (error) { toastManager.add({ type: "error", title: "Account not deleted", description: (error as Error).message }); setPending(false) }
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="destructive-outline" loading={pending} />}>Delete account and data</AlertDialogTrigger>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete your account?</AlertDialogTitle>
          <AlertDialogDescription>Your scenarios, runs, sweeps, geocoding results and travel snapshots are deleted now, and you are signed out. Server backups keep a copy until they expire. Download your data first if you want it.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost" />}>Keep my account</AlertDialogClose>
          <AlertDialogClose render={<Button variant="destructive" onClick={remove} />}>Delete everything</AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  )
}
