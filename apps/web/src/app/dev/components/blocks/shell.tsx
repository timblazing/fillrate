"use client"

import { ChevronDown, FlaskConical, GraduationCap, LayoutGrid, Map as MapIcon, Play, Settings, Share } from "lucide-react"
import { createContext, useContext } from "react"

import { TravelModeBadge } from "@/components/lab/provenance-badge"
import { Badge } from "@/components/ui/badge"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Group as ButtonGroup, GroupSeparator } from "@/components/ui/group"
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "@/components/ui/menu"
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs"
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import { scenario } from "../fixtures"

const nav = [
  [LayoutGrid, "Scenarios"],
  [MapIcon, "Workbench"],
  [FlaskConical, "Experiments"],
  [GraduationCap, "Learn"],
  [Settings, "Settings"],
] as const

export type NavItem = (typeof nav)[number][1]

// Workbench sections (spec §4). Allocate → Cluster → Solve run together from "Run pipeline" but stay inspectable.
export const sections = ["Data", "Inventory", "Fleet", "Constraints", "Travel", "Allocate", "Cluster", "Solve", "Results"] as const
export type Section = (typeof sections)[number]

export function RunPipelineButton({ onRun, running }: { onRun?: () => void; running?: boolean }) {
  return (
    <ButtonGroup>
      <Button size="sm" onClick={onRun} disabled={running}>
        <Play /> {running ? "Running…" : "Run pipeline"}
      </Button>
      <GroupSeparator />
      <Menu>
        <MenuTrigger render={<Button size="icon-sm" aria-label="Run options" />}>
          <ChevronDown />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem>Run pipeline</MenuItem>
          <MenuItem>Allocate only</MenuItem>
          <MenuItem>Explore k (clustering only)…</MenuItem>
          <MenuSeparator />
          <MenuItem>New sweep…</MenuItem>
        </MenuPopup>
      </Menu>
    </ButtonGroup>
  )
}

/** Set by the full-screen block route (`/dev/blocks/[id]`) so the shell fills the viewport. */
export const FullscreenContext = createContext(false)

/** Application frame for the blocks: icon rail, scenario header, and optional section tabs. */
export function AppShell({
  active = "Workbench",
  crumb,
  section,
  onSection,
  actions,
  height = 760,
  children,
}: {
  active?: NavItem
  /** Last breadcrumb after the scenario name. */
  crumb?: string
  section?: Section
  onSection?: (s: Section) => void
  actions?: React.ReactNode
  /** Design height in px. Full-screen views grow it to at least the viewport. */
  height?: number
  children: React.ReactNode
}) {
  const fullscreen = useContext(FullscreenContext)
  return (
    <div className="bg-background flex" style={{ height: fullscreen ? `max(100dvh, ${height}px)` : height }}>
      <nav className="bg-sidebar flex w-12 shrink-0 flex-col items-center gap-1 border-r py-3" aria-label="App">
        <div className="bg-foreground text-background mb-3 flex size-7 items-center justify-center rounded-lg">
          <FlaskConical className="size-4" />
        </div>
        {nav.map(([Icon, label]) => (
          <Tooltip key={label}>
            <TooltipTrigger
              aria-label={label}
              aria-current={label === active ? "page" : undefined}
              className={cn(
                "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground flex size-8 items-center justify-center rounded-lg transition-colors",
                label === active && "bg-sidebar-accent text-foreground"
              )}
            >
              <Icon className="size-4" />
            </TooltipTrigger>
            <TooltipPopup side="right">{label}</TooltipPopup>
          </Tooltip>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="#">{active === "Experiments" ? "Experiments" : "Scenarios"}</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {crumb ? <BreadcrumbLink href="#">{scenario.name}</BreadcrumbLink> : <BreadcrumbPage>{scenario.name}</BreadcrumbPage>}
              </BreadcrumbItem>
              {crumb && (
                <>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>{crumb}</BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              )}
            </BreadcrumbList>
          </Breadcrumb>
          <Badge variant="outline" className="font-mono">
            v{scenario.version}
          </Badge>
          <span className="text-muted-foreground hidden text-xs xl:inline">Saved · {scenario.author}</span>
          <div className="ml-auto flex items-center gap-2">
            <TravelModeBadge mode="haversine" detail="× 1.2" className="hidden lg:inline-flex" />
            {actions ?? (
              <>
                <Button variant="ghost" size="sm">
                  <Share /> Export
                </Button>
                <RunPipelineButton />
              </>
            )}
          </div>
        </header>
        {section && (
          <div className="overflow-x-auto border-b px-3 py-1.5">
            <Tabs value={section} onValueChange={(v) => onSection?.(v as Section)}>
              <TabsList variant="underline">
                {sections.map((t) => (
                  <TabsTab key={t} value={t}>
                    {t}
                  </TabsTab>
                ))}
              </TabsList>
            </Tabs>
          </div>
        )}
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
