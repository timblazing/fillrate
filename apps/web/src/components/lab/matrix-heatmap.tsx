"use client"

import { useState } from "react"

import { cn } from "@/lib/utils"

// Directed travel matrix inspector (spec §7). Rows are origins, columns destinations; null = unreachable.
// Large matrices will need virtualization; this renders every cell.
export function MatrixHeatmap({
  nodes,
  values,
  unit,
  className,
}: {
  nodes: string[]
  values: (number | null)[][]
  unit: string
  className?: string
}) {
  const [hover, setHover] = useState<[number, number] | null>(null)
  const finite = values.flat().filter((v): v is number => v != null && v > 0)
  const max = Math.max(...finite)
  const min = Math.min(...finite)

  const hovered = hover ? values[hover[0]][hover[1]] : undefined
  const reverse = hover ? values[hover[1]][hover[0]] : undefined

  return (
    <div className={cn("space-y-3", className)}>
      <div
        className="grid gap-px text-[10px]"
        style={{ gridTemplateColumns: `3.5rem repeat(${nodes.length}, minmax(1.75rem, 1fr))` }}
        onMouseLeave={() => setHover(null)}
      >
        <div />
        {nodes.map((n, j) => (
          <div
            key={n}
            className={cn(
              "text-muted-foreground truncate pb-1 text-center font-mono",
              hover?.[1] === j && "text-foreground font-semibold"
            )}
          >
            {n}
          </div>
        ))}
        {values.map((row, i) => (
          <div key={i} className="contents">
            <div
              className={cn(
                "text-muted-foreground flex items-center truncate pr-1 font-mono",
                hover?.[0] === i && "text-foreground font-semibold"
              )}
            >
              {nodes[i]}
            </div>
            {row.map((v, j) => {
              const t = v == null || v === 0 ? 0 : (v - min) / (max - min || 1)
              return (
                <div
                  key={j}
                  onMouseEnter={() => setHover([i, j])}
                  className={cn(
                    "flex aspect-square items-center justify-center rounded-[3px] font-mono tabular-nums transition-shadow",
                    v == null && "text-destructive bg-[repeating-linear-gradient(45deg,var(--destructive)_0_1px,transparent_1px_5px)] opacity-70",
                    v === 0 && "bg-muted text-muted-foreground",
                    hover && (hover[0] === i || hover[1] === j) && "ring-foreground/30 ring-1",
                    hover?.[0] === i && hover?.[1] === j && "ring-foreground ring-2"
                  )}
                  style={
                    v != null && v > 0
                      ? {
                          background: `color-mix(in oklch, var(--route-1) ${15 + t * 75}%, var(--card))`,
                          color: t > 0.55 ? "white" : undefined,
                        }
                      : undefined
                  }
                >
                  {v == null ? "∞" : v}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <div className="text-muted-foreground flex min-h-5 flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {hover ? (
          <>
            <span className="text-foreground font-mono">
              {nodes[hover[0]]} → {nodes[hover[1]]}
            </span>
            <span className="tabular-nums">{hovered == null ? "unreachable" : `${hovered} ${unit}`}</span>
            {hovered != null && reverse != null && hovered !== reverse && (
              <span className="text-route-4 tabular-nums">
                asymmetric: reverse is {reverse} {unit}
              </span>
            )}
          </>
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-16 rounded-full bg-[linear-gradient(90deg,color-mix(in_oklch,var(--route-1)_15%,var(--card)),var(--route-1))]" />
              {min}–{max} {unit}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-destructive font-mono">∞</span> unreachable edge
            </span>
          </>
        )}
      </div>
    </div>
  )
}
