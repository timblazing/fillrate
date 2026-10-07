import { AppShell } from "@/components/app/app-shell"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { pagePrincipal } from "@/lib/server/access"
import { mode } from "@/lib/server/auth"

export const dynamic = "force-dynamic"

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const who = await pagePrincipal()
  if (who.kind === "anonymous") redirect("/")
  if (who.kind === "pending") redirect("/request-access")
  // The sidebar remembers its collapsed state in a cookie (set by SidebarProvider).
  const open = (await cookies()).get("sidebar_state")?.value !== "false"
  const user = who.user ? { name: who.user.name, email: who.user.email, image: who.user.image } : null
  return <AppShell admin={Boolean(who.admin)} mode={mode().mode} user={user} defaultOpen={open}>{children}</AppShell>
}
