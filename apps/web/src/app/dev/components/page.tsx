import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { Gallery } from "./gallery"

export const metadata: Metadata = { title: "Component gallery · Fillrate" }

// Dev-only design-system reference: coss ui primitives, product components, charts, map, and pipeline blocks.
export default function ComponentGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound()
  return <Gallery />
}
