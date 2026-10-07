"use client"

import { ChevronDown, FlaskConical, GraduationCap, LayoutGrid, PanelLeft, Play, Route, Settings, Share, Truck } from "lucide-react"
import { Fragment, createContext, useContext } from "react"

import { Badge } from "@/components/ui/badge"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Group as ButtonGroup, GroupSeparator } from "@/components/ui/group"
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "@/components/ui/menu"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs"
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import { scenario } from "../fixtures"

// The app sidebar (components/app/app-sidebar.tsx) collapsed to icons: the workbench lives under Scenarios.
const nav = [
  [LayoutGrid, "Scenarios"],
  [FlaskConical, "Experiments"],
  [GraduationCap, "Learn"],
  [Route, "Labs"],
] as const
const navSecondary = [[Settings, "Settings"]] as const

export type NavItem = (typeof nav)[number][1] | (typeof navSecondary)[number][1]

// Workbench sections (spec §4). Allocate → Cluster → Solve run together from "Run pipeline" but stay inspectable.
export const sections = ["Data", "Inventory", "Fleet", "Constraints", "Travel", "Allocate", "Cluster", "Solve", "Results"] as const
export type Section = (typeof sections)[number]

// The same nine sections, grouped by the business question they answer (inputs, rules, the plan, and its results).
const sectionGroups: [string | null, Section[]][] = [
  ["Inputs", ["Data", "Inventory", "Fleet"]],
  ["Rules", ["Constraints", "Travel"]],
  ["Plan", ["Allocate", "Cluster", "Solve"]],
  [null, ["Results"]],
]

export function RunPipelineButton({ onRun, running, blocked }: { onRun?: () => void; running?: boolean; blocked?: boolean }) {
  return (
    <ButtonGroup>
      <Button size="sm" onClick={onRun} disabled={running || blocked} title={blocked ? "Resolve the blocking preflight checks first" : undefined}>
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
  active = "Scenarios",
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
  const railItem = ([Icon, label]: (typeof nav)[number] | (typeof navSecondary)[number]) => (
    <Tooltip key={label}>
      <TooltipTrigger
        aria-label={label}
        aria-current={label === active ? "page" : undefined}
        className={cn(
          "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex size-8 items-center justify-center rounded-lg transition-colors",
          label === active && "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
        )}
      >
        <Icon className="size-4" />
      </TooltipTrigger>
      <TooltipPopup side="right">{label}</TooltipPopup>
    </Tooltip>
  )
  return (
    <div className="bg-background flex" style={{ height: fullscreen ? `max(100dvh, ${height}px)` : height }}>
      <nav className="bg-sidebar flex w-12 shrink-0 flex-col items-center gap-1 border-r py-2" aria-label="App">
        <Tooltip>
          <TooltipTrigger aria-label="Overview" className="bg-foreground text-background mb-2 flex size-8 items-center justify-center rounded-lg">
            <Truck className="size-4" />
          </TooltipTrigger>
          <TooltipPopup side="right">Overview</TooltipPopup>
        </Tooltip>
        {nav.map(railItem)}
        <div className="mt-auto flex flex-col gap-1">{navSecondary.map(railItem)}</div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <Button variant="ghost" size="icon" className="size-7" aria-label="Toggle Sidebar">
            <PanelLeft />
          </Button>
          <Separator orientation="vertical" className="mr-1 h-4" />
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
          <div className="ml-auto flex items-center gap-2">
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
                {sectionGroups.map(([group, items], gi) => (
                  <Fragment key={group ?? "results"}>
                    {gi > 0 && <span aria-hidden className="bg-border mx-1.5 h-4 w-px self-center" />}
                    {group && (
                      <span aria-hidden className="text-muted-foreground/70 self-center px-1 text-[10px] font-medium tracking-wider uppercase">
                        {group}
                      </span>
                    )}
                    {items.map((t) => (
                      <TabsTab key={t} value={t}>
                        {t}
                      </TabsTab>
                    ))}
                  </Fragment>
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
