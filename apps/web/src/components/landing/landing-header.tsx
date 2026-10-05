"use client"

import { ArrowRight } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"

import { AccountButton } from "@/components/account/account-button"
import { BrandLink } from "@/components/brand/brand-link"
import { GitHubMark } from "@/components/brand/github-mark"
import { cn } from "@/lib/utils"

const ring = "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"

/** Landing header: blends into the hero until the page scrolls, then picks up a border and blur. */
export function LandingHeader({ repoUrl }: { repoUrl: string }) {
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
        <BrandLink className="[&>span]:text-sm" />

        <div className="flex items-center gap-2">
          <Link
            href="/scenarios"
            className={cn(
              "bg-card text-muted-foreground hover:text-foreground flex h-8 items-center gap-2 rounded-full border pr-1.5 pl-3 text-sm transition-colors hover:border-foreground/25 sm:w-48",
              ring,
            )}
          >
            <span className="flex-1">Open Fillrate</span>
            <span className="bg-muted flex size-5 items-center justify-center rounded-full">
              <ArrowRight aria-hidden="true" className="size-3" />
            </span>
          </Link>
          <AccountButton />
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
