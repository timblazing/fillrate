import Link from "next/link"
import { redirect } from "next/navigation"

import { Page, PageHeader } from "@/components/app/page"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { pagePrincipal, usage } from "@/lib/server/access"
import { mode } from "@/lib/server/auth"
import { initializeDatabase } from "@/lib/server/database"
import { scenarioList } from "@fillrate/db/scenarios"

import { DeleteAccountButton, DeleteScenarioButton, ExportButton, SignInButton } from "./account-actions"

export const dynamic = "force-dynamic"
export const metadata = { title: "Settings · Fillrate" }

const utc = (ms: number) => `${new Date(ms).toISOString().replace("T", " ").slice(0, 16)} UTC`

export default async function AccountPage() {
  const who = await pagePrincipal()
  if (who.kind === "pending") redirect("/request-access")
  const current = mode().mode
  const store = initializeDatabase()
  const quota = usage(store, who)
  const scenarios = who.ownerId ? (scenarioList(store, who.ownerId) as { id: string; name: string; revision: number; createdAt: number }[]) : []
  return (
    <Page>
      <PageHeader title="Settings" description="Workspace access, usage limits and saved data.">
        {current === "local" && <p className="text-muted-foreground text-sm text-pretty">This is a local installation: one account-free dataset stored on this machine. There is nothing to sign in to. Back up the data directory to keep it.</p>}
        {current === "operator" && <p className="text-muted-foreground text-sm text-pretty">This server has no accounts. Imported scenarios belong to its operator and need the operator key.</p>}
        {current === "hosted" && !who.user && (
          <>
            <p className="text-muted-foreground text-sm text-pretty">Sign in with GitHub to request access to import, save and run your own scenarios. The bundled examples stay open to everyone.</p>
            <div><SignInButton /></div>
          </>
        )}
        {who.user && <p className="text-sm">Signed in as <span className="font-medium">{who.user.name}</span> <span className="text-muted-foreground">({who.user.email})</span>.</p>}
      </PageHeader>

      {quota && (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">Limits</h2>
          <p className="text-muted-foreground text-sm text-pretty">Daily limits count the last 24 hours. Cancelling a run does not give its admission back. A sweep counts once toward unfinished jobs and once per run toward solves.</p>
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader><TableRow><TableHead>Limit</TableHead><TableHead className="text-right">Used</TableHead><TableHead className="text-right">Room frees up</TableHead></TableRow></TableHeader>
              <TableBody>
                <TableRow><TableCell>Unfinished jobs</TableCell><TableCell className="text-right tabular-nums">{quota.active.used} of {quota.active.limit}</TableCell><TableCell className="text-muted-foreground text-right text-xs">when one finishes</TableCell></TableRow>
                {([["Solve admissions per day", quota.solves], ["Geocoding jobs per day", quota.geocode], ["Address lookups per day", quota.lookups], ["Scenario saves per day", quota.saves], ["Travel matrix previews and uploads per day", quota.uploads], ["Manual plan evaluations per day", quota.evaluations]] as const).map(([label, q]) => (
                  <TableRow key={label}><TableCell>{label}</TableCell><TableCell className="text-right tabular-nums">{q.used} of {q.limit}</TableCell><TableCell className="text-muted-foreground text-right text-xs tabular-nums">{q.resetsAt ? utc(q.resetsAt) : "–"}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-muted-foreground text-xs">Uploads up to {Math.round(quota.upload_bytes / 1024 / 1024)} MB; sweeps up to {quota.max_sweep_runs} runs.</p>
        </section>
      )}

      {who.ownerId && (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">Your scenarios</h2>
          {scenarios.length === 0 ? (
            <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">No saved scenarios. <Link href="/scenarios" className="underline underline-offset-4">Import one</Link>.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader><TableRow><TableHead>Scenario</TableHead><TableHead>Version</TableHead><TableHead className="text-right">Saved</TableHead><TableHead className="w-12"><span className="sr-only">Delete</span></TableHead></TableRow></TableHeader>
                <TableBody>
                  {scenarios.map(s => (
                    <TableRow key={s.id}><TableCell>{s.name}</TableCell><TableCell className="tabular-nums">v{s.revision}</TableCell><TableCell className="text-muted-foreground text-right text-xs tabular-nums">{utc(s.createdAt)}</TableCell><TableCell><DeleteScenarioButton id={s.id} name={s.name} /></TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="flex flex-wrap gap-2"><ExportButton /></div>
        </section>
      )}

      {who.user && (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">Delete account</h2>
          <p className="text-muted-foreground text-sm text-pretty">Deletes your account and everything it owns. Cancel unfinished runs first.</p>
          <div><DeleteAccountButton /></div>
        </section>
      )}

      <p className="text-muted-foreground text-sm"><Link href="/privacy" className="underline underline-offset-4">How Fillrate stores, keeps and deletes data</Link></p>
    </Page>
  )
}
