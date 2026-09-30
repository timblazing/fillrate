"use client"

import dynamic from "next/dynamic"
import { Fragment, useEffect, useRef, useState } from "react"
import { FlaskConical, Hash, Search } from "lucide-react"

import { ThemeToggle } from "@/components/theme/theme-toggle"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSeparator,
} from "@/components/ui/command"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

import { Blocks } from "./sections/blocks"
import { Charts } from "./sections/charts"
import { Foundations } from "./sections/foundations"
import { exploreK } from "./fixtures"
import { Lab } from "./sections/lab"
import { Later } from "./sections/later"
import { Primitives } from "./sections/primitives"
import { Group, Specimen } from "./specimen"
import { toc } from "./toc"

const PipelineMap = dynamic(() => import("./pipeline-map"), {
  ssr: false,
  loading: () => <Skeleton className="h-[520px] w-full rounded-xl" />,
})

const allIds = toc.flatMap((g) => g.items.map(([id]) => id))

type JumpItem = { value: string; label: string; id: string }
const jumpGroups = toc.map((g) => ({
  value: g.title,
  items: g.items.map(([id, title]): JumpItem => ({ value: id, label: title, id })),
}))

// Highlights the specimen nearest the top of the viewport.
function useActiveSection() {
  const [active, setActive] = useState<string>(allIds[0])
  useEffect(() => {
    const visible = new Map<string, number>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target.id, e.boundingClientRect.top)
          else visible.delete(e.target.id)
        }
        const first = allIds.find((id) => visible.has(id))
        if (first) setActive(first)
      },
      { rootMargin: "-64px 0px -55% 0px" }
    )
    for (const id of allIds) {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [])
  return active
}

function confidenceK7() {
  const e = exploreK()
  const d = e.detail(7)
  return new Map(e.stopIds.map((id, i) => [id, d.confidence[i]]))
}

// Specimens mount as they near the viewport and change height, so re-aim once the scroll settles.
function jump(id: string, behavior: ScrollBehavior = "smooth") {
  const el = document.getElementById(id)
  if (!el) return
  history.replaceState(null, "", `#${id}`)
  const offset = parseFloat(getComputedStyle(el).scrollMarginTop) || 0
  const aligned = () => Math.abs(el.getBoundingClientRect().top - offset) < 2
  let tries = 3
  const settle = () => {
    if (aligned() || tries-- === 0) return
    window.addEventListener("scrollend", () => requestAnimationFrame(settle), { once: true })
    el.scrollIntoView({ behavior: "instant", block: "start" })
  }
  if (aligned()) return
  window.addEventListener("scrollend", () => requestAnimationFrame(settle), { once: true })
  el.scrollIntoView({ behavior, block: "start" })
}

// Plain-click nav links go through jump() so they land on their target.
function onNavClick(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  jump(id)
}

export function Gallery() {
  const active = useActiveSection()

  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1))
    if (id) jump(id, "instant")
  }, [])
  const navRef = useRef<HTMLElement>(null)

  // Keep the active nav item visible inside the scrollable sticky nav, without moving the page.
  useEffect(() => {
    const nav = navRef.current
    const link = nav?.querySelector<HTMLElement>(`a[href="#${active}"]`)
    if (!nav || !link) return
    const top = link.offsetTop // the sticky nav is the offsetParent
    if (top < nav.scrollTop + 40 || top > nav.scrollTop + nav.clientHeight - 80) {
      nav.scrollTo({ top: top - nav.clientHeight / 3, behavior: "smooth" })
    }
  }, [active])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <div className="min-h-svh">
      <header className="bg-background/80 sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4 backdrop-blur-md sm:px-6">
        <div className="bg-foreground text-background flex size-7 items-center justify-center rounded-lg">
          <FlaskConical className="size-4" />
        </div>
        <span className="font-semibold tracking-tight">Fillrate</span>
        <span className="text-muted-foreground hidden text-sm sm:inline">/ design system</span>
        <Badge variant="outline" className="hidden sm:inline-flex">
          dev only
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" className="text-muted-foreground justify-start sm:w-44" onClick={() => setOpen(true)} aria-label="Jump to component">
            <Search /> <span className="hidden sm:inline">Jump to…</span>
            <KbdGroup className="ml-auto hidden sm:inline-flex">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </KbdGroup>
          </Button>
          <ThemeToggle />
        </div>
      </header>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandDialogPopup>
          <Command items={jumpGroups}>
            <CommandInput placeholder="Search components…" />
            <CommandPanel>
              <CommandEmpty>No components found.</CommandEmpty>
              <CommandList>
                {(group: (typeof jumpGroups)[number]) => (
                  <Fragment key={group.value}>
                    <CommandGroup items={group.items}>
                      <CommandGroupLabel>{group.value}</CommandGroupLabel>
                      <CommandCollection>
                        {(item: JumpItem) => (
                          <CommandItem
                            key={item.id}
                            value={item}
                            onClick={() => {
                              setOpen(false)
                              jump(item.id)
                            }}
                          >
                            <Hash /> {item.label}
                          </CommandItem>
                        )}
                      </CommandCollection>
                    </CommandGroup>
                    <CommandSeparator />
                  </Fragment>
                )}
              </CommandList>
            </CommandPanel>
          </Command>
        </CommandDialogPopup>
      </CommandDialog>

      <div className="mx-auto flex max-w-[88rem] gap-12 px-4 pt-14 pb-32 sm:px-6">
        <nav ref={navRef} className="sticky top-20 hidden h-[calc(100svh-6rem)] w-48 shrink-0 overflow-y-auto pb-8 text-sm lg:block" aria-label="Gallery sections">
          {toc.map((g, gi) => (
            <div key={g.id} className="mb-5">
              <a href={`#${g.id}`} onClick={(e) => onNavClick(e, g.id)} className="text-foreground mb-1.5 flex items-center gap-2 px-2 text-xs font-semibold">
                <span className="text-muted-foreground font-mono tabular-nums">{String(gi + 1).padStart(2, "0")}</span>
                {g.title}
              </a>
              <ul className="border-border ml-3 space-y-px border-l">
                {g.items.map(([id, title]) => (
                  <li key={id}>
                    <a
                      href={`#${id}`}
                      onClick={(e) => onNavClick(e, id)}
                      className={cn(
                        "-ml-px block border-l py-1 pl-3 transition-colors duration-150",
                        active === id
                          ? "border-foreground text-foreground font-medium"
                          : "text-muted-foreground hover:text-foreground border-transparent"
                      )}
                    >
                      {title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <main className="min-w-0 flex-1 space-y-24">
          <Foundations />
          <Primitives onOpenCommand={() => setOpen(true)} />
          <Lab />
          <Charts />
          <Group id="maps" index={5} load="windowed" title="Map" description="mapcn on MapLibre. Stops are one GeoJSON circle layer; hulls and the leg-limit ring use Turf. Colors come from useCssColors, since MapLibre can't read CSS variables.">
            <Specimen
              id="map"
              title="Pipeline map"
              source="@mapcn/map · lab/map-layers · pipeline-map.tsx"
              spec="§4 §10"
              description="Stops by cluster, cluster hulls, and the selected cluster's truck paths (straight schematic lines, open routes). Hollow red stops are beyond the leg limit. Click a stop or a swatch."
            >
              <PipelineMap />
            </Specimen>
            <Specimen
              id="map-confidence"
              title="Confidence map"
              source="pipeline-map.tsx · confidence mode"
              spec="§8a"
              description="The same stops colored by k-explorer assignment confidence at k = 7. Unstable border stops stand out in red."
            >
              <PipelineMap confidence={confidenceK7()} defaultMode="confidence" selectedCluster={null} />
            </Specimen>
          </Group>
          <Blocks />
          <Later />
        </main>
      </div>
    </div>
  )
}
