"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

import { BrandLink } from "@/components/brand/brand-link"
import { AccountButton } from "@/components/account/account-button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

const links = [
  { href: "/dev", label: "Progress" },
  { href: "/dev/components", label: "Design system" },
] as const

// Sticky header for the /dev pages (progress and design system). The product itself uses AppShell.
export function DevHeader({ children }: { children?: ReactNode }) {
  const pathname = usePathname()

  return (
    <header className="bg-background/80 sticky top-0 z-30 grid h-14 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b px-4 backdrop-blur-md sm:px-6">
      <BrandLink hideLabelOnMobile />
      <nav aria-label="Development" className="absolute left-1/2 max-w-[calc(100%-7rem)] -translate-x-1/2 overflow-x-auto overflow-y-hidden">
        <Tabs value={links.find(({ href }) => pathname === href || (href !== "/dev" && pathname.startsWith(`${href}/`)))?.href} className="gap-0">
          <TabsList variant="line" className="gap-x-0.5 py-0 sm:gap-x-1">
            {links.map(({ href, label }) => (
              <TabsTrigger
                key={href}
                value={href}
                render={<Link href={href} />}
                nativeButton={false}
                className="px-2 py-2 text-xs sm:px-3 sm:text-sm"
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </nav>
      <div className="col-start-3 ml-auto flex items-center gap-2 sm:gap-3">
        {children}
        <AccountButton />
      </div>
    </header>
  )
}
