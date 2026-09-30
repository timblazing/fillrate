import { cn } from "@/lib/utils"

// Inline copy of app/icon.svg. The outline uses currentColor so it follows the
// next-themes class instead of the favicon's prefers-color-scheme query.
export function AppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" className={cn("text-foreground size-7 shrink-0", className)}>
      <rect x="6" y="6" width="88" height="88" rx="20" fill="none" stroke="currentColor" strokeWidth="6" />
      <rect x="18" y="42" width="64" height="40" rx="8" fill="#4693E5" />
    </svg>
  )
}
