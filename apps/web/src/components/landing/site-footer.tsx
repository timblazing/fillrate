import Link from "next/link"

import { BrandLink } from "@/components/brand/brand-link"

const linkRing = "rounded-sm transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"

/** Compact footer for the public pages: wordmark left, GitHub and Privacy right. */
export function SiteFooter({ repoUrl }: { repoUrl: string }) {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <BrandLink showMark={false} className="text-muted-foreground hover:text-foreground transition-colors [&>span]:text-sm [&>span]:font-normal" />
        <nav aria-label="Footer" className="text-muted-foreground flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <a href={repoUrl} target="_blank" rel="noopener noreferrer" className={linkRing}>GitHub</a>
          <Link href="/privacy" className={linkRing}>Privacy</Link>
        </nav>
      </div>
    </footer>
  )
}
