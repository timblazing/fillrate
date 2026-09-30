import type { Metadata } from "next"

import { Gallery } from "./gallery"

export const metadata: Metadata = { title: "Component gallery · Fillrate" }

// Public design-system reference: coss ui primitives, product components, charts, map, and pipeline blocks.
export default function ComponentGalleryPage() {
  return <Gallery />
}
