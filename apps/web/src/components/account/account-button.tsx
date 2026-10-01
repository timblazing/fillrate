"use client"

import { LogIn, LogOut, UserRound } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuLinkItem, MenuPopup, MenuSeparator, MenuTrigger } from "@/components/ui/menu"
import { authClient, signInWithGitHub, type Me } from "@/lib/client/auth-client"

// Hosted mode only: "Sign in" or the account menu. Local and operator deployments have no accounts, so it renders nothing.
export function AccountButton() {
  const [me, setMe] = useState<Me | null>(null)
  const [pending, setPending] = useState(false)
  const router = useRouter()
  useEffect(() => {
    let live = true
    fetch("/api/v1/me", { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).then(body => { if (live) setMe(body) }, () => {})
    return () => { live = false }
  }, [])
  if (!me || me.mode !== "hosted") return null
  if (!me.user) {
    return (
      <Button size="sm" variant="outline" loading={pending} onClick={() => { setPending(true); signInWithGitHub().catch(() => setPending(false)) }}>
        <LogIn aria-hidden />
        <span className="sr-only sm:not-sr-only">Sign in</span>
      </Button>
    )
  }
  const initials = me.user.name.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?"
  return (
    <Menu>
      <MenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={`Account: ${me.user.name}`} />}>
        <Avatar className="size-7">
          {me.user.image && <AvatarImage src={me.user.image} alt="" />}
          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
        </Avatar>
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuGroup>
          <MenuGroupLabel>{me.user.name}</MenuGroupLabel>
          <MenuLinkItem href="/account"><UserRound aria-hidden />Account and data</MenuLinkItem>
        </MenuGroup>
        <MenuSeparator />
        <MenuItem onClick={async () => { await authClient.signOut(); setMe({ ...me, user: null, owner: false }); router.push("/"); router.refresh() }}><LogOut aria-hidden />Sign out</MenuItem>
      </MenuPopup>
    </Menu>
  )
}
