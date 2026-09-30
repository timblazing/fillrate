"use client"

import { Check, Copy } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// Read-only code preview with copy, for Python reproduction bundles and JSON exports (spec §13).
export function CodeBlock({
  code,
  filename,
  className,
}: {
  code: string
  filename?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className={cn("bg-muted/40 overflow-hidden rounded-xl border", className)}>
      <div className="flex h-9 items-center gap-2 border-b pr-1.5 pl-3">
        <span className="flex gap-1">
          <span className="bg-border size-2.5 rounded-full" />
          <span className="bg-border size-2.5 rounded-full" />
          <span className="bg-border size-2.5 rounded-full" />
        </span>
        {filename && <span className="text-muted-foreground ml-1 font-mono text-xs">{filename}</span>}
        <Button variant="ghost" size="icon-xs" className="ml-auto" onClick={copy} aria-label="Copy code">
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
      <pre className="overflow-x-auto p-4 text-xs leading-relaxed">
        <code>
          {code.split("\n").map((line, i) => (
            <span key={i} className="grid grid-cols-[2rem_1fr]">
              <span className="text-muted-foreground/60 select-none tabular-nums">{i + 1}</span>
              <span>{highlight(line)}</span>
            </span>
          ))}
        </code>
      </pre>
    </div>
  )
}

// Tiny Python-ish highlighter: comments, strings, keywords, numbers. Enough for previews.
function highlight(line: string) {
  const comment = line.indexOf("#")
  const body = comment >= 0 ? line.slice(0, comment) : line
  const parts = body.split(/(\b(?:from|import|for|in|def|return|print)\b|"[^"]*"|\b\d[\d_]*\b)/g)
  return (
    <>
      {parts.map((p, i) =>
        /^(from|import|for|in|def|return|print)$/.test(p) ? (
          <span key={i} className="text-route-5">{p}</span>
        ) : /^"/.test(p) ? (
          <span key={i} className="text-route-3">{p}</span>
        ) : /^\d/.test(p) ? (
          <span key={i} className="text-route-2">{p}</span>
        ) : (
          p
        )
      )}
      {comment >= 0 && <span className="text-muted-foreground italic">{line.slice(comment)}</span>}
    </>
  )
}
