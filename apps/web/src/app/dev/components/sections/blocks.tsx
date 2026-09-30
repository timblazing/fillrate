"use client"

import dynamic from "next/dynamic"
import { useState } from "react"
import {
  ChevronDown,
  FlaskConical,
  GraduationCap,
  LayoutGrid,
  Map as MapIcon,
  Play,
  Settings,
  Share,
} from "lucide-react"

import { DiagnosticList } from "@/components/lab/diagnostic-list"
import { Explainer } from "@/components/lab/explainer"
import { JobStatusBadge } from "@/components/lab/job-status"
import { CoordinateSourceBadge, TravelModeBadge } from "@/components/lab/provenance-badge"
import { RouteTimeline } from "@/components/lab/route-timeline"
import { RouteSwatch } from "@/components/lab/route-swatch"
import { StatTile } from "@/components/lab/stat-tile"
import { Badge } from "@/components/ui/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Group as ButtonGroup, GroupSeparator } from "@/components/ui/group"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs"
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import { convergence, stops, timelineRoutes } from "../sample-data"
import { Group, Specimen } from "../specimen"

const MapDemo = dynamic(() => import("../map-demo"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full" />,
})

const nav = [
  [LayoutGrid, "Scenarios"],
  [MapIcon, "Workbench"],
  [FlaskConical, "Experiments"],
  [GraduationCap, "Learn"],
  [Settings, "Settings"],
] as const

export function Blocks() {
  const [selectedStop, setSelectedStop] = useState<string | null>("c-03")
  const stop = stops.find((s) => s.id === selectedStop)

  return (
    <Group
      id="blocks"
      index={6}
      title="Blocks"
      description="Lab components composed into real screens. These are the starting point for the M2 Blocks page and the M3 workbench."
    >
      <Specimen id="workbench" title="Workbench" spec="§4" description="Shell, section tabs, map, inspector, and bottom timeline. Selecting a stop in the timeline updates the inspector." bodyClassName="p-0 overflow-hidden">
        <div className="bg-background flex h-[720px]">
          <nav className="bg-sidebar flex w-12 shrink-0 flex-col items-center gap-1 border-r py-3">
            <div className="bg-foreground text-background mb-3 flex size-7 items-center justify-center rounded-lg">
              <FlaskConical className="size-4" />
            </div>
            {nav.map(([Icon, label], i) => (
              <Tooltip key={label}>
                <TooltipTrigger
                  aria-label={label}
                  className={cn(
                    "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground flex size-8 items-center justify-center rounded-lg transition-colors",
                    i === 1 && "bg-sidebar-accent text-foreground"
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
                    <BreadcrumbLink href="#">Scenarios</BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>Downtown deliveries</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
              <Badge variant="outline" className="font-mono">
                v13
              </Badge>
              <div className="ml-auto flex items-center gap-2">
                <TravelModeBadge mode="haversine" detail="25 mph" className="hidden md:inline-flex" />
                <Button variant="ghost" size="sm">
                  <Share /> Export
                </Button>
                <ButtonGroup>
                  <Button size="sm">
                    <Play /> Solve
                  </Button>
                  <GroupSeparator />
                  <Button size="icon-sm" aria-label="Solve options">
                    <ChevronDown />
                  </Button>
                </ButtonGroup>
              </div>
            </header>
            <div className="border-b px-3 py-1.5">
              <Tabs defaultValue="results">
                <TabsList variant="underline">
                  {["Data", "Inventory", "Fleet", "Constraints", "Travel", "Solve", "Results"].map((t) => (
                    <TabsTab key={t} value={t.toLowerCase()}>
                      {t}
                    </TabsTab>
                  ))}
                </TabsList>
              </Tabs>
            </div>

            <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
              <ResizablePanel defaultSize="72%">
                <ResizablePanelGroup orientation="vertical">
                  <ResizablePanel defaultSize="62%">
                    <MapDemo embedded />
                  </ResizablePanel>
                  <ResizableHandle />
                  <ResizablePanel defaultSize="38%">
                    <div className="h-full overflow-auto p-3">
                      <RouteTimeline
                        routes={timelineRoutes}
                        from={7.75 * 60}
                        to={14 * 60}
                        selectedStop={selectedStop}
                        onSelectStop={setSelectedStop}
                      />
                    </div>
                  </ResizablePanel>
                </ResizablePanelGroup>
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel defaultSize="28%" minSize="20%">
                <aside className="h-full space-y-4 overflow-auto p-4">
                  {stop ? (
                    <>
                      <div className="space-y-1">
                        <div className="text-muted-foreground font-mono text-xs">{stop.id}</div>
                        <div className="flex items-center gap-2 text-lg font-semibold">
                          {stop.label}
                          {stop.route && <RouteSwatch route={stop.route} />}
                        </div>
                        <CoordinateSourceBadge source={stop.source} />
                      </div>
                      <div className="flex flex-col gap-4">
                        <Field>
                          <FieldLabel className="gap-1.5">
                            Demand
                            <Explainer term="Demand" meaning="Quantity delivered at this stop, per load dimension." units="integer units" field="Client.delivery" />
                          </FieldLabel>
                          <InputGroup>
                            <InputGroupInput defaultValue={stop.demand} key={`d-${stop.id}`} />
                            <InputGroupAddon align="inline-end">
                              <InputGroupText>units</InputGroupText>
                            </InputGroupAddon>
                          </InputGroup>
                        </Field>
                        <Field>
                          <FieldLabel>Time window</FieldLabel>
                          <InputGroup>
                            <InputGroupInput defaultValue={stop.window} key={`w-${stop.id}`} className="font-mono" />
                          </InputGroup>
                        </Field>
                      </div>
                      {stop.source === "zcta" && (
                        <DiagnosticList items={[{ severity: "warning", title: "Approximate coordinate", detail: "ZCTA internal point. Drag the marker to correct it." }]} />
                      )}
                    </>
                  ) : (
                    <p className="text-muted-foreground text-sm">Select a stop on the map, table, or timeline.</p>
                  )}
                </aside>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        </div>
      </Specimen>

      <Specimen id="results-header" title="Results header" spec="§10" description="Run identity, status, and headline metrics above the results tabs.">
        <div className="bg-background space-y-4 rounded-xl border p-4">
          <div className="flex flex-wrap items-center gap-3">
            <JobStatusBadge state="succeeded" />
            <div>
              <div className="font-semibold">Baseline · seed 0</div>
              <div className="text-muted-foreground font-mono text-xs">run-0142 · PyVRP 0.14.0 · 30 s · 41 ms/iter</div>
            </div>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm">
                Compare…
              </Button>
              <Button variant="outline" size="sm">
                Branch from run
              </Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatTile label="Objective" value="$318.20" delta={-4.1} trend={convergence.map((c) => c.seed0)} />
            <StatTile label="Distance" value="18.7" unit="mi" delta={-6.2} />
            <StatTile label="Duration" value="6h 42m" delta={1.8} />
            <StatTile label="Vehicles used" value="3" unit="of 3" />
            <StatTile label="Orders fulfilled" value="87" unit="%" delta={3.4} goodWhen="up" />
          </div>
        </div>
      </Specimen>
    </Group>
  )
}
