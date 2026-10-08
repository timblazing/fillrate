import Link from "next/link"

import { BrandLink } from "@/components/brand/brand-link"

// Header for public pages (privacy).
export function PublicHeader() {
  return (
    <header className="bg-background/80 sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b px-4 backdrop-blur-md sm:px-6">
      <BrandLink />
      <nav aria-label="Main navigation" className="flex items-center gap-4 sm:gap-6">
        <Link href="/#faq" className="text-muted-foreground hover:text-foreground rounded-sm text-sm">FAQ</Link>
        <Link href="/scenarios" className="text-muted-foreground hover:text-foreground rounded-sm text-sm">Open app</Link>
      </nav>
    </header>
  )
}
