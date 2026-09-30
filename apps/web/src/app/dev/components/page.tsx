import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { Gallery } from "./gallery"

export const metadata: Metadata = { title: "Component gallery · PyVRP Lab" }

// Dev-only reference of every shadcn/mapcn component, used to match the OpenPencil design system.
export default function ComponentGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound()
  return <Gallery />
}
