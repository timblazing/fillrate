"use client"

import type { LabInstance } from "@fillrate/contracts"
import { Play, RotateCcw } from "lucide-react"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"

import { LabPlot } from "@/components/lab/lab-plot"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toastManager } from "@/components/ui/toast"

type ExampleInfo = { id: string; label: string; name: string; description: string; coordinates: string; clients: number; dimensions: number; vehicle_types: number; observations: string[] }

const pretty = (value: unknown) => JSON.stringify(value, null, 2)

/**
 * The bundled instance as editable JSON. Unchanged, it runs as the public example; edited, it runs as the caller's own
 * instance (operator/local mode or a signed-in account), validated on the server in TypeScript and again in Python.
 */
export function LabEditor({ example, instance, open, canEdit, closedNote, runKey }: { example: ExampleInfo; instance: LabInstance; open: boolean; canEdit: boolean; closedNote: string; runKey?: string }) {
  const router = useRouter()
  const original = useMemo(() => pretty(instance), [instance])
  const [text, setText] = useState(original)
  const [pending, setPending] = useState(false)
  const parsed = useMemo(() => {
    try { return { value: JSON.parse(text) as LabInstance, error: null } } catch (error) { return { value: null, error: error instanceof Error ? error.message : "Invalid JSON." } }
  }, [text])
  const edited = text !== original && !(parsed.value && pretty(parsed.value) === original)
  const blocked = !open || Boolean(parsed.error) || (edited && !canEdit)

  async function run() {
    setPending(true)
    try {
      const res = await fetch("/api/v1/lab/runs", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID(), ...(runKey ? { "x-run-key": runKey } : {}) },
        body: JSON.stringify(edited ? { instance: parsed.value } : { example: example.id }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error?.message ?? "Could not start the lab run.")
      router.push(`/labs/${body.id}${runKey ? `?key=${encodeURIComponent(runKey)}` : ""}`)
    } catch (error) {
      toastManager.add({ type: "error", title: "Lab run not started", description: error instanceof Error ? error.message : undefined })
      setPending(false)
    }
  }

  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" aria-labelledby="lab-instance">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="lab-instance" className="font-medium">{example.name}</h2>
          <Badge variant="outline">{example.coordinates === "planar" ? "Planar, abstract units" : "Geographic"}</Badge>
          {edited && <Badge variant="warning">Edited</Badge>}
        </div>
        <p className="text-muted-foreground text-sm text-pretty">{example.description} Synthetic data only.</p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lab-json">Instance JSON</Label>
          <Textarea
            id="lab-json"
            value={text}
            onChange={(event) => setText(event.target.value)}
            readOnly={!canEdit}
            spellCheck={false}
            aria-invalid={parsed.error ? true : undefined}
            className="font-mono text-xs [&_textarea]:h-80 [&_textarea]:font-mono [&_textarea]:text-xs"
          />
          {parsed.error && <p className="text-destructive-foreground text-xs" role="alert">{parsed.error}</p>}
          {!canEdit && <p className="text-muted-foreground text-xs">Read-only: bundled examples run unchanged. Sign in (or use local mode) to run an edited instance of your own.</p>}
        </div>
        {open ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={run} loading={pending} disabled={blocked}>
              <Play aria-hidden /> {edited ? "Run my instance" : "Run example"}
            </Button>
            <Button variant="outline" onClick={() => setText(original)} disabled={!edited && !parsed.error}>
              <RotateCcw aria-hidden /> Reset
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">{closedNote}</p>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <LabPlot instance={parsed.value && !parsed.error ? safeInstance(parsed.value, instance) : instance} result={null} />
        <div className="bg-card rounded-xl border p-4">
          <h3 className="text-sm font-medium">What to look for</h3>
          <ul className="text-muted-foreground mt-2 list-disc space-y-1 pl-5 text-sm text-pretty">
            {example.observations.map((o) => <li key={o}>{o}</li>)}
          </ul>
        </div>
      </div>
    </section>
  )
}

/** Plot the edited instance only when it has the shape the plot needs; the server validates it fully. */
function safeInstance(value: LabInstance, fallback: LabInstance): LabInstance {
  const ok = value && Array.isArray(value.depots) && value.depots.length === 1 && Array.isArray(value.clients) && value.clients.every((c) => c && typeof c.id === "string")
    && (value.coordinates === "planar" || value.coordinates === "geographic")
  return ok ? value : fallback
}
