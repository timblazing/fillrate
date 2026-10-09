"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import { BrandLink } from "@/components/brand/brand-link"
import { GitHubMark } from "@/components/brand/github-mark"
import { cn } from "@/lib/utils"

const ring = "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"

/** Landing header: blends into the hero until the page scrolls, then picks up a border and blur. An external `action` opens in a new tab. */
export function LandingHeader({ repoUrl, action = { href: "/scenarios", label: "Open app" } }: { repoUrl: string; action?: { href: string; label: string } }) {
  const external = action.href.startsWith("http")
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b transition-[background-color,border-color] duration-200",
        scrolled ? "bg-background/80 border-border backdrop-blur-md" : "bg-background border-transparent",
      )}
    >
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <BrandLink showMark={false} className="[&>span]:text-sm" />

        <div className="flex items-center gap-4">
          {external ? (
            <a href={action.href} target="_blank" rel="noopener noreferrer" className={cn("text-muted-foreground hover:text-foreground rounded-sm text-sm transition-colors", ring)}>
              {action.label}
            </a>
          ) : (
            <Link href={action.href} className={cn("text-muted-foreground hover:text-foreground rounded-sm text-sm transition-colors", ring)}>
              {action.label}
            </Link>
          )}
          <span aria-hidden="true" className="bg-border h-4 w-px" />
          <a
            href={repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Fillrate on GitHub"
            className={cn("text-muted-foreground hover:bg-muted hover:text-foreground flex size-8 items-center justify-center rounded-full transition-colors", ring)}
          >
            <GitHubMark className="size-4" />
          </a>
        </div>
      </div>
    </header>
  )
}
