"use client"

import { Activity, ClipboardCheck, Play, Shapes } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

import { AppIcon } from "@/components/brand/app-icon"
import { ThemeToggle } from "@/components/theme/theme-toggle"
import { cn } from "@/lib/utils"

const links = [
  { href: "/runs", label: "Runs", icon: Play },
  { href: "/dev", label: "Progress", icon: Activity },
  { href: "/dev/components", label: "Design system", icon: Shapes },
  { href: "/dev/review", label: "Review", icon: ClipboardCheck },
] as const

// Shared sticky header for the /dev and /runs pages. `children` go on the right, before the theme toggle.
export function DevHeader({ children }: { children?: ReactNode }) {
  const pathname = usePathname()

  return (
    <header className="bg-background/80 sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4 backdrop-blur-md sm:px-6">
      <Link href="/dev" className="flex items-center gap-2.5 rounded-md">
        <AppIcon />
        <span className="sr-only font-semibold tracking-tight sm:not-sr-only">Fillrate</span>
      </Link>
      <nav aria-label="Development" className="flex items-center gap-0.5">
        {links.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          const className = cn(
            "flex h-8 items-center gap-1.5 rounded-md px-2 text-sm transition-colors duration-150 sm:px-2.5",
            active ? "bg-accent text-foreground font-medium" : "text-muted-foreground hover:text-foreground"
          )
          const content = (
            <>
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className="sr-only md:not-sr-only">{label}</span>
            </>
          )
          // The current page is not a link, so its query string (the review link's ?key=) survives.
          return active ? (
            <span key={href} aria-current="page" className={className}>
              {content}
            </span>
          ) : (
            <Link key={href} href={href} className={className}>
              {content}
            </Link>
          )
        })}
      </nav>
      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        {children}
        <ThemeToggle />
      </div>
    </header>
  )
}
