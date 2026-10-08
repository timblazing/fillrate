import { AppShell } from "@/components/app/app-shell"
import { playgroundMode } from "@/lib/server/playground"
import { cookies } from "next/headers"

export const dynamic = "force-dynamic"

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // The sidebar remembers its collapsed state in a cookie (set by SidebarProvider).
  const open = (await cookies()).get("sidebar_state")?.value !== "false"
  return <AppShell defaultOpen={open} playground={playgroundMode()}>{children}</AppShell>
}
