import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { FullscreenBlock, type BlockId } from "../../components/sections/blocks"
import { toc } from "../../components/specimen"

const blockItems = toc.find((g) => g.id === "blocks")!.items

function block(id: string) {
  return blockItems.find(([blockId]) => blockId === id)
}

export async function generateMetadata({ params }: PageProps<"/dev/blocks/[id]">): Promise<Metadata> {
  const item = block((await params).id)
  return { title: item ? `${item[1]} · Fillrate` : "Fillrate" }
}

// Dev-only: one gallery block filling the viewport, for design review and screenshots.
export default async function FullscreenBlockPage({ params }: PageProps<"/dev/blocks/[id]">) {
  if (process.env.NODE_ENV === "production") notFound()
  const item = block((await params).id)
  if (!item) notFound()
  return <FullscreenBlock id={item[0] as BlockId} />
}
