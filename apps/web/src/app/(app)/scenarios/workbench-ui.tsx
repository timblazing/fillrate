import type { ReactNode } from "react"
import { Card, CardDescription, CardHeader, CardPanel, CardTitle } from "@/components/ui/card"
import { Field as FieldRoot, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@/components/ui/select"

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <FieldRoot className="min-w-0 items-stretch gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      {children}
    </FieldRoot>
  )
}

/** A labelled coss Select over a fixed list of options. */
export function Pick<T extends string>({
  label,
  value,
  items,
  onChange,
}: {
  label: string
  value: T
  items: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <Field label={label}>
      <Select
        value={value}
        items={items}
        onValueChange={next => {
          if (next !== null) onChange(next as T)
        }}
      >
        <SelectTrigger className="w-full min-w-0">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {items.map(item => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </Field>
  )
}

/** A titled Card section; the heading stays an h2. */
export function Section({
  title,
  description,
  action,
  children,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle render={<h2 />}>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {action}
      </CardHeader>
      <CardPanel className="flex flex-col items-start gap-4 [&>*:not(button)]:self-stretch">{children}</CardPanel>
    </Card>
  )
}

/** An input that commits on blur or Enter. */
export function EditCell({ label, value, onCommit }: { label: string; value: string | number; onCommit: (value: string) => void }) {
  return (
    <Input
      key={String(value)}
      aria-label={label}
      className="min-w-24"
      defaultValue={value}
      onBlur={e => onCommit(e.target.value)}
      onKeyDown={e => {
        if (e.key === "Enter") e.currentTarget.blur()
      }}
    />
  )
}

export function download(name: string, content: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
