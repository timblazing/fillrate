import type { ReactNode } from "react"

// Inline markdown for text lifted from the docs: `code`, **bold**, and [links](url). Nothing else.
export function Md({ children }: { children: string }) {
  const parts: ReactNode[] = children.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/).map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 1)
      return (
        <code key={i} className="bg-muted text-foreground rounded px-1 py-px font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      )
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i} className="text-foreground font-semibold">{part.slice(2, -2)}</strong>
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (link)
      return (
        <a key={i} href={link[2]} className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground">
          {link[1]}
        </a>
      )
    return part
  })
  return <>{parts}</>
}
