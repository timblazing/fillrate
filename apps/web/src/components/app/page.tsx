import type { ComponentProps, ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * Page layout for every signed-in product page (everything under `app/(app)`). AppShell supplies the sidebar and the
 * breadcrumb header; each page renders exactly one `Page` so width, gutters and vertical rhythm match everywhere:
 *
 *   <Page>
 *     <PageHeader title="Pipeline runs" description="…" actions={<Button />}>{optional controls}</PageHeader>
 *     <PageSection title="Recent runs">…</PageSection>
 *   </Page>
 *
 * Detail views whose header is a toolbar (back button, status badge, exports) use `PageTitle` for the heading instead.
 * Don't add per-page `max-w-*`, `mx-auto` or page padding; constrain prose inside the page instead.
 */
export function Page({ className, ...props }: ComponentProps<"main">) {
  return <main className={cn("mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8", className)} {...props} />
}

export function PageTitle({ className, ...props }: ComponentProps<"h1">) {
  return <h1 className={cn("text-2xl font-semibold tracking-tight", className)} {...props} />
}

/** Title, a one-paragraph description, optional actions aligned right, and optional controls below. */
export function PageHeader({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <header className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <PageTitle>{title}</PageTitle>
          {description && <div className="text-muted-foreground max-w-3xl text-sm text-pretty">{description}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  )
}

/** A titled block of a page. Sections stack with the page's gap; content inside a section uses `gap-3`. */
export function PageSection({
  title,
  description,
  actions,
  children,
  className,
  ...props
}: Omit<ComponentProps<"section">, "title"> & { title?: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cn("flex flex-col gap-3", className)} {...props}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-lg font-semibold tracking-tight">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {description && <div className="text-muted-foreground max-w-3xl text-sm text-pretty">{description}</div>}
      {children}
    </section>
  )
}
