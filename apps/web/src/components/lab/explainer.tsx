import { BookOpen, CircleHelp } from "lucide-react"

import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover"

// Contextual explanation (spec §4): plain meaning, units, a small example, model field, and docs.
export function Explainer({
  term,
  meaning,
  units,
  example,
  field,
  docsHref,
}: {
  term: string
  meaning: string
  units?: string
  example?: string
  field?: string
  docsHref?: string
}) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`What is ${term}?`}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <CircleHelp className="size-3.5" />
      </PopoverTrigger>
      <PopoverPopup className="w-80 p-0 text-sm" align="start">
        <div className="space-y-1.5 p-3">
          <div className="font-medium">{term}</div>
          <p className="text-muted-foreground text-xs leading-relaxed">{meaning}</p>
        </div>
        <dl className="bg-muted/40 grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-1.5 border-t p-3 text-xs">
          {units && (
            <>
              <dt className="text-muted-foreground">Units</dt>
              <dd>{units}</dd>
            </>
          )}
          {example && (
            <>
              <dt className="text-muted-foreground">Example</dt>
              <dd>{example}</dd>
            </>
          )}
          {field && (
            <>
              <dt className="text-muted-foreground">Model field</dt>
              <dd>
                <code className="bg-background rounded border px-1 py-px font-mono text-[11px]">{field}</code>
              </dd>
            </>
          )}
        </dl>
        {docsHref && (
          <a
            href={docsHref}
            target="_blank"
            rel="noreferrer"
            className="hover:bg-muted flex items-center gap-1.5 border-t px-3 py-2 text-xs font-medium transition-colors"
          >
            <BookOpen className="size-3.5" /> PyVRP documentation
          </a>
        )}
      </PopoverPopup>
    </Popover>
  )
}
