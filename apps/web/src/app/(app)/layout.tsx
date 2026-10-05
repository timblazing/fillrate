import { AppShell } from "@/components/app/app-shell"
import { PublicHeader } from "@/components/brand/public-header"
import { pagePrincipal } from "@/lib/server/access"

export const dynamic = "force-dynamic"

// The product (scenarios, runs, experiments, lessons, account) gets the dashboard frame. Signed-out visitors of
// the open pages (lessons, bundled examples) see the public header instead.
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const who = await pagePrincipal()
  if (who.kind === "anonymous") {
    return (
      <div className="flex min-h-dvh flex-col">
        <PublicHeader />
        {children}
      </div>
    )
  }
  return <AppShell admin={Boolean(who.admin)}>{children}</AppShell>
}
