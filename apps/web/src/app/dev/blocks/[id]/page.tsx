import type { Metadata } from "next"
import { pagePrincipal } from "@/lib/server/access"
import { notFound, redirect } from "next/navigation"

import { FullscreenBlock, type BlockId } from "../../components/sections/blocks"
import { toc } from "../../components/toc"

const blockItems = toc.find((g) => g.id === "blocks")!.items

function block(id: string) {
  return blockItems.find(([blockId]) => blockId === id)
}

export async function generateMetadata({ params }: PageProps<"/dev/blocks/[id]">): Promise<Metadata> {
  const item = block((await params).id)
  return { title: item ? `${item[1]} · Fillrate` : "Fillrate" }
}

// One gallery block filling the viewport, for design review and screenshots.
export default async function FullscreenBlockPage({ params }: PageProps<"/dev/blocks/[id]">) {
  const who = await pagePrincipal()
  if (who.kind === "anonymous") redirect("/")
  if (who.kind === "pending") redirect("/request-access")
  const item = block((await params).id)
  if (!item) notFound()
  return <FullscreenBlock id={item[0] as BlockId} />
}
