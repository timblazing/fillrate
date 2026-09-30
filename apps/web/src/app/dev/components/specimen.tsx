"use client"

import { createContext, useContext, useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

/**
 * When a specimen's body renders. The header and anchor always render, so the nav, scroll-spy, and ⌘K keep working.
 * - `lazy`: mount once it comes within a viewport of the screen, then keep it.
 * - `windowed`: mount only while within a viewport of the screen. For maps (one WebGL context each), charts, and blocks.
 */
export type SpecimenLoad = "lazy" | "windowed"

const GroupLoad = createContext<SpecimenLoad>("lazy")

function useNearViewport(ref: React.RefObject<HTMLElement | null>, load: SpecimenLoad) {
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNear(true)
          if (load === "lazy") observer.disconnect()
        } else if (load === "windowed") {
          setNear(false)
        }
      },
      { rootMargin: "100% 0px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, load])
  return near
}

export function Group({
  id,
  index,
  title,
  description,
  load = "lazy",
  children,
}: {
  id: string
  index: number
  title: string
  description: string
  /** Default `load` for this group's specimens. */
  load?: SpecimenLoad
  children: React.ReactNode
}) {
  return (
    <GroupLoad value={load}>
      <section id={id} className="scroll-mt-20 space-y-8">
        <header className="space-y-2 border-b pb-4">
          <h2 className="flex items-baseline gap-3 text-2xl font-semibold tracking-tight">
            <span className="text-muted-foreground/50 font-mono tabular-nums">{String(index).padStart(2, "0")}</span>
            {title}
          </h2>
          <p className="text-muted-foreground max-w-2xl text-sm text-pretty">{description}</p>
        </header>
        {children}
      </section>
    </GroupLoad>
  )
}

// One component (or recipe) with its name, what it's for, and where it lives.
export function Specimen({
  id,
  title,
  description,
  actions,
  className,
  bodyClassName,
  load,
  children,
}: {
  id: string
  title: string
  description?: string
  /** Controls at the end of the title row (e.g. open full screen). */
  actions?: React.ReactNode
  className?: string
  bodyClassName?: string
  /** Overrides the group's `load`. */
  load?: SpecimenLoad
  children: React.ReactNode
}) {
  const groupLoad = useContext(GroupLoad)
  const articleRef = useRef<HTMLElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const near = useNearViewport(articleRef, load ?? groupLoad)

  // Keep the last rendered height while unmounted so the page doesn't shift under the reader.
  const [placeholderHeight, setPlaceholderHeight] = useState<number>()
  useEffect(() => {
    const body = bodyRef.current
    if (!near || !body) return
    const observer = new ResizeObserver(() => setPlaceholderHeight(body.offsetHeight))
    observer.observe(body)
    return () => observer.disconnect()
  }, [near])

  return (
    <article ref={articleRef} id={id} className={cn("scroll-mt-20 space-y-3", className)}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-medium">
          <a href={`#${id}`} className="group/anchor hover:underline hover:underline-offset-4">
            {title}
            <span className="text-muted-foreground ml-1.5 opacity-0 transition-opacity group-hover/anchor:opacity-100">
              #
            </span>
          </a>
        </h3>
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
      {description && <p className="text-muted-foreground -mt-1 max-w-3xl text-sm text-pretty">{description}</p>}
      <div
        ref={bodyRef}
        className={cn(
          "bg-card relative overflow-x-auto rounded-2xl border p-4 sm:p-6 [background-image:radial-gradient(var(--border)_1px,transparent_1px)] [background-size:16px_16px]",
          bodyClassName
        )}
        style={near ? undefined : { height: placeholderHeight ?? 320 }}
      >
        {near && children}
      </div>
    </article>
  )
}

export function Row({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-2.5", className)}>
      <div className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">{label}</div>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}
