"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Fragment, type ReactNode } from "react"

import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"

import { AppSidebar } from "./app-sidebar"
import type { NavUserProps } from "./nav-user"

type Crumb = { label: string; href?: string }

const short = (id: string) => id.slice(0, 8)

/** Breadcrumb trail for the current route; the sidebar carries the brand and the account, so the header only locates the page. */
export function crumbsFor(pathname: string): Crumb[] {
  const [section, id, sub] = pathname.split("/").filter(Boolean)
  switch (section) {
    case "scenarios":
      return [{ label: "Scenarios" }]
    case "runs":
      if (!id) return [{ label: "Scenarios", href: "/scenarios" }, { label: "Pipeline runs" }]
      return [
        { label: "Scenarios", href: "/scenarios" },
        { label: "Pipeline runs", href: "/runs" },
        ...(sub === "sheet" ? [{ label: `Run ${short(id)}`, href: `/runs/${id}` }, { label: "Shipment sheets" }] : [{ label: `Run ${short(id)}` }]),
      ]
    case "explore":
      return [{ label: "Scenarios", href: "/scenarios" }, { label: "k explorer" }]
    case "experiments":
      return id ? [{ label: "Experiments", href: "/experiments" }, { label: `Sweep ${short(id)}` }] : [{ label: "Experiments" }]
    case "account":
      return [{ label: "Settings" }]
    case "admin":
      return [{ label: "Access requests" }]
    default:
      return []
  }
}

/**
 * Application frame for the signed-in product (shadcn sidebar-07 layout): a standard sidebar that collapses to icons, plus a
 * sticky breadcrumb header. Pages render inside it with `Page` from `./page`, which owns width, gutters and spacing.
 * The content column is a div, not SidebarInset's <main>, because each page supplies its own <main>.
 */
export function AppShell({
  admin,
  mode,
  user,
  defaultOpen = true,
  children,
}: {
  admin: boolean
  mode: "hosted" | "local" | "operator"
  user: NavUserProps | null
  defaultOpen?: boolean
  children: ReactNode
}) {
  const crumbs = crumbsFor(usePathname())
  return (
    <SidebarProvider defaultOpen={defaultOpen} className="print:block print:min-h-0 print:bg-transparent print:[&>[data-slot=sidebar]]:hidden">
      <AppSidebar admin={admin} mode={mode} user={user} />
      <div
        data-slot="sidebar-inset"
        className="bg-background relative flex w-full min-w-0 flex-1 flex-col"
      >
        <header className="bg-background/80 sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b px-4 backdrop-blur-md print:hidden">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Breadcrumb className="min-w-0">
            <BreadcrumbList className="flex-nowrap">
              {crumbs.map((crumb, i) => (
                <Fragment key={crumb.label}>
                  {i > 0 && <BreadcrumbSeparator className="hidden md:block" />}
                  <BreadcrumbItem className={i < crumbs.length - 1 ? "hidden md:inline-flex" : "min-w-0"}>
                    {crumb.href ? (
                      <BreadcrumbLink render={<Link href={crumb.href} />}>{crumb.label}</BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        </header>
        {children}
      </div>
    </SidebarProvider>
  )
}
