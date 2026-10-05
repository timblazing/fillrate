"use client"

import { FlaskConical, GraduationCap, LayoutGrid, Settings, Shield, Truck } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

import { AccountButton } from "@/components/account/account-button"
import { BrandLink } from "@/components/brand/brand-link"
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const nav = [
  { href: "/scenarios", label: "Scenarios", icon: LayoutGrid },
  { href: "/experiments", label: "Experiments", icon: FlaskConical },
  { href: "/learn", label: "Learn", icon: GraduationCap },
] as const

const footer = [
  { href: "/account", label: "Settings", icon: Settings },
] as const

// Runs and the k explorer are opened from a scenario (spec §4 has no Runs destination), so they belong under Scenarios.
const sectionOf = (pathname: string) =>
  pathname.startsWith("/explore") || pathname === "/runs" || pathname.startsWith("/runs/") ? "/scenarios" : [...nav, ...footer, { href: "/admin" }].find(({ href }) => pathname === href || pathname.startsWith(`${href}/`))?.href

/** Application frame for the signed-in product: icon rail (as in the design-system workbench block) plus a slim top bar. */
export function AppShell({ admin, children }: { admin: boolean; children: ReactNode }) {
  const pathname = usePathname()
  const active = sectionOf(pathname)
  const items = [...nav, ...footer, ...(admin ? [{ href: "/admin", label: "Access requests", icon: Shield }] : [])]
  const link = ({ href, label, icon: Icon }: (typeof items)[number]) => (
    <Tooltip key={href}>
      <TooltipTrigger
        render={<Link href={href} />}
        aria-label={label}
        aria-current={href === active ? "page" : undefined}
        className={cn(
          "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground flex size-8 items-center justify-center rounded-lg transition-colors",
          href === active && "bg-sidebar-accent text-foreground"
        )}
      >
        <Icon className="size-4" />
      </TooltipTrigger>
      <TooltipPopup side="right">{label}</TooltipPopup>
    </Tooltip>
  )
  return (
    <div className="flex min-h-dvh flex-col sm:flex-row">
      <nav className="bg-sidebar flex h-12 shrink-0 items-center gap-1 overflow-x-auto border-b px-3 sm:sticky sm:top-0 sm:h-dvh sm:w-12 sm:flex-col sm:overflow-visible sm:border-r sm:border-b-0 sm:px-0 sm:py-3" aria-label="App">
        <Link href="/" aria-label="Fillrate home" className="bg-foreground text-background mr-2 flex size-7 shrink-0 sm:mr-0 sm:mb-3 items-center justify-center rounded-lg">
          <Truck className="size-4" />
        </Link>
        {items.filter(({ href }) => !footer.some((f) => f.href === href) && href !== "/admin").map(link)}
        <div className="ml-auto flex items-center gap-1 sm:mt-auto sm:ml-0 sm:flex-col">{items.filter(({ href }) => footer.some((f) => f.href === href) || href === "/admin").map(link)}</div>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/80 sticky top-0 z-30 flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4 backdrop-blur-md">
          <BrandLink className="[&_svg]:hidden" />
          <AccountButton />
        </header>
        {children}
      </div>
    </div>
  )
}
