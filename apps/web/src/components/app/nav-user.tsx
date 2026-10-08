"use client"

import { ChevronsUpDown, HardDrive, LogOut, Settings, Shield } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuLinkItem, MenuPopup, MenuSeparator, MenuTrigger } from "@/components/ui/menu"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar"
import { authClient } from "@/lib/client/auth-client"

export type NavUserProps = { name: string; email: string; image: string | null }

const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?"

/** Avatar plus name and email; local and operator deployments have no account, so they show the workspace instead. */
function Identity({ user, workspace, pending = 0 }: { user: NavUserProps | null; workspace: string; pending?: number }) {
  return (
    <>
      <span className="relative shrink-0">
        {user ? (
          <Avatar className="size-8 rounded-lg">
            {user.image && <AvatarImage src={user.image} alt="" />}
            <AvatarFallback className="rounded-lg text-xs">{initials(user.name)}</AvatarFallback>
          </Avatar>
        ) : (
          <span className="bg-sidebar-accent flex size-8 items-center justify-center rounded-lg">
            <HardDrive className="size-4" aria-hidden />
          </span>
        )}
        {pending > 0 && <span className="bg-info ring-sidebar absolute -top-0.5 -right-0.5 size-2.5 rounded-full ring-2" aria-hidden />}
      </span>
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{user?.name ?? workspace}</span>
        <span className="text-muted-foreground truncate text-xs">{user?.email ?? "No account needed"}</span>
      </div>
    </>
  )
}

/**
 * Sidebar footer account menu (shadcn sidebar-07 NavUser): identity, account destinations, then Sign out.
 * Account-level pages (Settings, and Access requests for admins) live here rather than in the sidebar nav.
 */
export function NavUser({
  user,
  admin,
  workspace,
  active,
  onNavigate,
}: {
  user: NavUserProps | null
  admin: boolean
  workspace: string
  active?: string
  onNavigate?: () => void
}) {
  const { isMobile } = useSidebar()
  const router = useRouter()
  // Admins see how many access requests wait for review.
  const [pending, setPending] = useState(0)
  useEffect(() => {
    if (!admin) return
    let live = true
    fetch("/api/v1/me", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((me) => { if (live) setPending(me?.pending_count ?? 0) }, () => {})
    return () => { live = false }
  }, [admin])
  const label = user ? `Account: ${user.name}` : workspace
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Menu>
          <MenuTrigger
            render={<SidebarMenuButton size="lg" aria-label={pending > 0 ? `${label}, ${pending} access requests waiting` : label} className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground" />}
          >
            <Identity user={user} workspace={workspace} pending={pending} />
            <ChevronsUpDown className="ml-auto size-4" />
          </MenuTrigger>
          <MenuPopup side={isMobile ? "bottom" : "right"} align="end" sideOffset={4} className="min-w-56">
            <MenuGroup>
              <MenuGroupLabel className="flex items-center gap-2 font-normal">
                <Identity user={user} workspace={workspace} />
              </MenuGroupLabel>
            </MenuGroup>
            <MenuSeparator />
            <MenuGroup>
              <MenuLinkItem render={<Link href="/account" onClick={onNavigate} aria-current={active === "/account" ? "page" : undefined} />}>
                <Settings aria-hidden />
                Settings
              </MenuLinkItem>
              {admin && (
                <MenuLinkItem render={<Link href="/admin" onClick={onNavigate} aria-current={active === "/admin" ? "page" : undefined} />}>
                  <Shield aria-hidden />
                  Access requests
                  {pending > 0 && <Badge variant="info" className="ml-auto tabular-nums">{pending}</Badge>}
                </MenuLinkItem>
              )}
            </MenuGroup>
            {user && (
              <>
                <MenuSeparator />
                <MenuItem
                  onClick={async () => {
                    await authClient.signOut()
                    router.push("/")
                    router.refresh()
                  }}
                >
                  <LogOut aria-hidden />
                  Sign out
                </MenuItem>
              </>
            )}
          </MenuPopup>
        </Menu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
