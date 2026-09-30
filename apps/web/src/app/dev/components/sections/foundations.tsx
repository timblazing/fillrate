"use client"

import { Group, Row, Specimen } from "../specimen"

const colorPairs = [
  ["background", "foreground"],
  ["card", "card-foreground"],
  ["popover", "popover-foreground"],
  ["primary", "primary-foreground"],
  ["secondary", "secondary-foreground"],
  ["muted", "muted-foreground"],
  ["accent", "accent-foreground"],
  ["destructive", "background"],
  ["sidebar", "sidebar-foreground"],
  ["sidebar-primary", "sidebar-primary-foreground"],
] as const

const lines = ["border", "input", "ring", "chart-grid"]

export function Foundations() {
  return (
    <Group
      id="foundations"
      index={1}
      title="Foundations"
      description="CSS variables in globals.css, mirrored by name on the OpenPencil Foundations page. Token changes flow .fig → globals.css."
    >
      <Specimen id="color" title="Color" source="src/app/globals.css" description="Surface / content pairs as they are actually used together.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {colorPairs.map(([bg, fg]) => (
            <div key={bg} className="overflow-hidden rounded-xl border">
              <div
                className="flex h-20 items-end justify-between p-3 text-sm font-medium"
                style={{ background: `var(--${bg})`, color: `var(--${fg})` }}
              >
                Aa
                <span className="text-[10px] opacity-70">{fg.replace(`${bg}-`, "")}</span>
              </div>
              <div className="bg-card space-y-0.5 border-t px-3 py-2">
                <div className="font-mono text-[11px] font-medium">--{bg}</div>
              </div>
            </div>
          ))}
        </div>
        <Row label="Lines & focus" className="mt-6">
          {lines.map((t) => (
            <div key={t} className="flex items-center gap-2">
              <span className="bg-card size-9 rounded-lg border-2" style={{ borderColor: `var(--${t})` }} />
              <span className="font-mono text-[11px]">--{t}</span>
            </div>
          ))}
        </Row>
      </Specimen>

      <Specimen
        id="route-palette"
        title="Route palette"
        source="--route-1 … --route-8"
        spec="§4"
        description="Stable per-route colors shared by map, timeline, tables, and categorical charts. Always paired with a number or label. Placeholder values until the design pass; chart-1…5 are still neutral."
      >
        <div className="grid grid-cols-4 gap-3 lg:grid-cols-8">
          {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
            <div key={n} className="group space-y-2">
              <div
                className="flex aspect-square items-end rounded-xl p-2 text-lg font-semibold text-white shadow-sm transition-transform duration-200 group-hover:-translate-y-1"
                style={{ background: `var(--route-${n})` }}
              >
                {n}
              </div>
              <div className="font-mono text-[11px]">--route-{n}</div>
            </div>
          ))}
        </div>
        <div className="mt-6 flex h-3 overflow-hidden rounded-full">
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className="flex-1" style={{ background: `var(--route-${i + 1})` }} />
          ))}
        </div>
        <Row label="Chart (shadcn)" className="mt-6">
          {Array.from({ length: 5 }, (_, i) => i + 1).map((n) => (
            <div key={n} className="flex items-center gap-2 text-xs">
              <span className="size-6 rounded-md border" style={{ background: `var(--chart-${n})` }} />
              <span className="font-mono text-[11px]">--chart-{n}</span>
            </div>
          ))}
        </Row>
      </Specimen>

      <Specimen id="type" title="Typography" source="Geist / Geist Mono">
        <div className="grid gap-8 lg:grid-cols-[1fr_16rem]">
          <div className="space-y-4">
            {[
              ["text-4xl font-semibold tracking-tight", "4xl / semibold", "Route the city."],
              ["text-2xl font-semibold tracking-tight", "2xl / semibold", "Downtown deliveries · v13"],
              ["text-lg font-medium", "lg / medium", "Solve settings"],
              ["text-sm", "sm / regular", "Body text. The default workbench size for tables, inspectors, and forms."],
              ["text-muted-foreground text-xs", "xs / muted", "Captions, units, and secondary metadata."],
              ["font-mono text-xs tabular-nums", "mono xs / tabular", "12.4 mi · 00:47:12 · c-0042 · $318.20"],
            ].map(([className, label, sample]) => (
              <div key={label} className="grid grid-cols-[8rem_1fr] items-baseline gap-4">
                <span className="text-muted-foreground font-mono text-[11px]">{label}</span>
                <span className={className}>{sample}</span>
              </div>
            ))}
          </div>
          <div className="bg-muted/50 space-y-2 rounded-xl border p-4 text-sm">
            <div className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">Numbers</div>
            <p className="text-muted-foreground text-xs">
              Use <code className="font-mono">tabular-nums</code> anywhere numbers line up: tables, tiles, timelines.
            </p>
            <div className="font-mono text-2xl tabular-nums">
              1,111.11
              <br />
              8,888.88
            </div>
          </div>
        </div>
      </Specimen>

      <Specimen id="radius" title="Radius & elevation" source="--radius (0.625rem)">
        <Row label="Radius">
          {["sm", "md", "lg", "xl", "2xl", "3xl"].map((r) => (
            <div key={r} className="flex flex-col items-center gap-1.5 text-xs">
              <div className="bg-muted size-14 border" style={{ borderRadius: `var(--radius-${r})` }} />
              {r}
            </div>
          ))}
        </Row>
        <Row label="Elevation" className="mt-6">
          {[
            ["flat", "border"],
            ["sm", "border shadow-sm"],
            ["md", "border shadow-md"],
            ["popover", "border shadow-lg"],
          ].map(([label, className]) => (
            <div key={label} className={`bg-card flex h-16 w-28 items-end rounded-xl p-2 text-xs ${className}`}>
              {label}
            </div>
          ))}
        </Row>
      </Specimen>
    </Group>
  )
}
