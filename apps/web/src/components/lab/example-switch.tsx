import Link from "next/link"

import { Button } from "@/components/ui/button"

export type ExampleOption = { id: string; name: string; blurb: string; orders: number; lines: number; locations: number }

/** Server-rendered scenario picker for the bundled synthetic examples; the choice lives in `?example=`. */
export function ExampleSwitch({ examples, current, href }: { examples: ExampleOption[]; current: string; href: (id: string) => string }) {
  const selected = examples.find((e) => e.id === current) ?? examples[0]
  return (
    <div className="flex flex-col gap-2">
      <nav aria-label="Bundled scenario" className="flex flex-wrap gap-2">
        {examples.map((e) => (
          <Button key={e.id} size="sm" variant={e.id === selected.id ? "secondary" : "outline"} aria-current={e.id === selected.id ? "page" : undefined} render={<Link href={href(e.id)} scroll={false} />}>
            {e.id === "lesson" ? "Lesson, 2,000 orders" : `Small example, ${e.orders} orders`}
          </Button>
        ))}
      </nav>
      <p className="text-muted-foreground text-xs text-pretty">
        <span className="text-foreground font-medium">{selected.name}</span> · {selected.orders.toLocaleString()} orders, {selected.lines.toLocaleString()} lines,{" "}
        {selected.locations.toLocaleString()} locations. {selected.blurb}. Synthetic data only.
      </p>
    </div>
  )
}
