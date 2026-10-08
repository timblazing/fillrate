"use client"

import { ChevronRight, FlaskConical, LayoutGrid, Truck, type LucideIcon } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { type ComponentProps } from "react"

import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar"

import { NavUser, type NavUserProps } from "./nav-user"

type NavItem = { href: string; title: string; icon: LucideIcon; items?: { href: string; title: string }[] }

// Spec §4 destinations. Runs and the k explorer open from a scenario, so they sit under Scenarios.
const navMain: NavItem[] = [
  { href: "/scenarios", title: "Scenarios", icon: LayoutGrid, items: [{ href: "/scenarios", title: "Workbench" }, { href: "/runs", title: "Pipeline runs" }] },
  { href: "/experiments", title: "Experiments", icon: FlaskConical },
]

const under = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`)

/** Top-level section for a path: runs and the explorer belong to Scenarios. */
export const sectionOf = (pathname: string) =>
  under(pathname, "/runs") || under(pathname, "/explore") ? "/scenarios" : [...navMain, { href: "/account" }, { href: "/admin" }].find(({ href }) => under(pathname, href))?.href

const modeLabel = { hosted: "Hosted workspace", local: "Local workspace", operator: "Operator workspace" } as const

/**
 * Product sidebar, modeled on shadcn sidebar-07 (standard sidebar that collapses to icons): brand, main nav with sub-items,
 * secondary nav pinned to the bottom, and the account menu (Settings, Access requests, Sign out) in the footer.
 * Only the header's SidebarTrigger (or ⌘B) toggles it; there is deliberately no SidebarRail.
 */
export function AppSidebar({ admin, mode, user, ...props }: { admin: boolean; mode: keyof typeof modeLabel; user: NavUserProps | null } & ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const active = sectionOf(pathname)
  const { isMobile, setOpenMobile } = useSidebar()
  // The mobile sidebar is a sheet: close it once a destination is chosen.
  const close = () => isMobile && setOpenMobile(false)

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip="Overview" render={<Link href="/scenarios" onClick={close} />}>
              <div className="bg-foreground text-background flex aspect-square size-8 items-center justify-center rounded-lg">
                <Truck className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">Fillrate</span>
                <span className="text-muted-foreground truncate text-xs">{modeLabel[mode]}</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="App" className="contents print:hidden">
          <SidebarGroup>
            <SidebarGroupLabel>Platform</SidebarGroupLabel>
            <SidebarMenu>
              {navMain.map((item) => (
                <Collapsible key={item.href} defaultOpen={item.href === active} render={<SidebarMenuItem />}>
                  <SidebarMenuButton
                    tooltip={item.title}
                    isActive={item.href === active && !item.items}
                    aria-current={item.href === active ? "page" : undefined}
                    render={<Link href={item.href} onClick={close} />}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                  {item.items?.length ? (
                    <>
                      <CollapsibleTrigger render={<SidebarMenuAction className="data-panel-open:rotate-90" />}>
                        <ChevronRight />
                        <span className="sr-only">Toggle {item.title}</span>
                      </CollapsibleTrigger>
                      <CollapsiblePanel>
                        <SidebarMenuSub>
                          {item.items.map((sub) => {
                            const current = sub.href === "/scenarios" ? pathname === "/scenarios" : under(pathname, sub.href) || (sub.href === "/runs" && under(pathname, "/explore"))
                            return (
                              <SidebarMenuSubItem key={sub.href}>
                                <SidebarMenuSubButton isActive={current} render={<Link href={sub.href} onClick={close} aria-current={current ? "page" : undefined} />}>
                                  <span>{sub.title}</span>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            )
                          })}
                        </SidebarMenuSub>
                      </CollapsiblePanel>
                    </>
                  ) : null}
                </Collapsible>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </nav>
      </SidebarContent>
      <SidebarFooter className="print:hidden">
        <NavUser user={user} admin={admin} workspace={modeLabel[mode]} active={active} onNavigate={close} />
      </SidebarFooter>
    </Sidebar>
  )
}
