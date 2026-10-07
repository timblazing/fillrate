"use client"

import { ChevronsUpDown, LogOut } from "lucide-react"
import { useRouter } from "next/navigation"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "@/components/ui/menu"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar"
import { authClient } from "@/lib/client/auth-client"

export type NavUserProps = { name: string; email: string; image: string | null }

const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?"

function Identity({ user }: { user: NavUserProps }) {
  return (
    <>
      <Avatar className="size-8 rounded-lg">
        {user.image && <AvatarImage src={user.image} alt="" />}
        <AvatarFallback className="rounded-lg text-xs">{initials(user.name)}</AvatarFallback>
      </Avatar>
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{user.name}</span>
        <span className="text-muted-foreground truncate text-xs">{user.email}</span>
      </div>
    </>
  )
}

/** Sidebar footer account menu (sidebar-08 NavUser). Hosted mode only: local and operator deployments have no accounts. */
export function NavUser({ user }: { user: NavUserProps }) {
  const { isMobile } = useSidebar()
  const router = useRouter()
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Menu>
          <MenuTrigger
            render={<SidebarMenuButton size="lg" aria-label={`Account: ${user.name}`} className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground" />}
          >
            <Identity user={user} />
            <ChevronsUpDown className="ml-auto size-4" />
          </MenuTrigger>
          <MenuPopup side={isMobile ? "bottom" : "right"} align="end" sideOffset={4} className="min-w-56">
            <MenuGroup>
              <MenuGroupLabel className="flex items-center gap-2 font-normal">
                <Identity user={user} />
              </MenuGroupLabel>
            </MenuGroup>
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
          </MenuPopup>
        </Menu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
