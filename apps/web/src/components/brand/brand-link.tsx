import Link from "next/link"
import { Truck } from "lucide-react"

import { cn } from "@/lib/utils"

/** Fillrate mark and wordmark linking home; shared by every header. */
export function BrandLink({ className, hideLabelOnMobile }: { className?: string; hideLabelOnMobile?: boolean }) {
  return (
    <Link href="/" aria-label="Fillrate home" className={cn("flex shrink-0 items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring", className)}>
      <Truck aria-hidden="true" className="size-5" />
      <span className={cn("text-lg font-semibold tracking-tight", hideLabelOnMobile && "sr-only sm:not-sr-only")}>Fillrate</span>
    </Link>
  )
}
