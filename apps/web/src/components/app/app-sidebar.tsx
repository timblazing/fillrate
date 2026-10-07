"use client"

import { ChevronRight, FlaskConical, GraduationCap, LayoutGrid, Route, Settings, Shield, Truck, type LucideIcon } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState, type ComponentProps } from "react"

import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"

import { NavUser, type NavUserProps } from "./nav-user"

type NavItem = { href: string; title: string; icon: LucideIcon; items?: { href: string; title: string }[] }

// Spec §4 destinations. Runs and the k explorer open from a scenario, so they sit under Scenarios.
const navMain: NavItem[] = [
  { href: "/scenarios", title: "Scenarios", icon: LayoutGrid, items: [{ href: "/scenarios", title: "Workbench" }, { href: "/runs", title: "Pipeline runs" }] },
  { href: "/experiments", title: "Experiments", icon: FlaskConical },
  { href: "/learn", title: "Learn", icon: GraduationCap },
  // Solver Lab (spec §4 "Progressive depth"): a working lower-level tool, so it gets a destination (M6).
  { href: "/labs", title: "Labs", icon: Route },
]

const under = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`)

/** Top-level section for a path: runs and the explorer belong to Scenarios. */
export const sectionOf = (pathname: string) =>
  under(pathname, "/runs") || under(pathname, "/explore") ? "/scenarios" : [...navMain, { href: "/account" }, { href: "/admin" }].find(({ href }) => under(pathname, href))?.href

const modeLabel = { hosted: "Hosted workspace", local: "Local workspace", operator: "Operator workspace" } as const

/** Product sidebar, modeled on shadcn sidebar-08: brand, main nav with sub-items, secondary nav, account footer. */
export function AppSidebar({ admin, mode, user, ...props }: { admin: boolean; mode: keyof typeof modeLabel; user: NavUserProps | null } & ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const active = sectionOf(pathname)
  const { isMobile, setOpenMobile } = useSidebar()
  // The mobile sidebar is a sheet: close it once a destination is chosen.
  const close = () => isMobile && setOpenMobile(false)
  // Admins see how many access requests wait for review.
  const [pending, setPending] = useState(0)
  useEffect(() => {
    if (!admin) return
    let live = true
    fetch("/api/v1/me", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((me) => { if (live) setPending(me?.pending_count ?? 0) }, () => {})
    return () => { live = false }
  }, [admin])
  const navSecondary = [{ href: "/account", title: "Settings", icon: Settings }, ...(admin ? [{ href: "/admin", title: "Access requests", icon: Shield }] : [])]

  return (
    <Sidebar variant="inset" collapsible="icon" {...props}>
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
          <SidebarGroup className="mt-auto">
            <SidebarGroupContent>
              <SidebarMenu>
                {navSecondary.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      size="sm"
                      tooltip={item.title}
                      isActive={item.href === active}
                      aria-current={item.href === active ? "page" : undefined}
                      render={<Link href={item.href} onClick={close} />}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                    {item.href === "/admin" && pending > 0 && <SidebarMenuBadge>{pending}</SidebarMenuBadge>}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </nav>
      </SidebarContent>
      {user && (
        <SidebarFooter>
          <NavUser user={user} />
        </SidebarFooter>
      )}
      {props.collapsible !== "none" && <SidebarRail />}
    </Sidebar>
  )
}
