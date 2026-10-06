import { AppShell } from "@/components/app/app-shell"
import { redirect } from "next/navigation"
import { pagePrincipal } from "@/lib/server/access"

export const dynamic = "force-dynamic"

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const who = await pagePrincipal()
  if (who.kind === "anonymous") redirect("/")
  if (who.kind === "pending") redirect("/request-access")
  return <AppShell admin={Boolean(who.admin)}>{children}</AppShell>
}
