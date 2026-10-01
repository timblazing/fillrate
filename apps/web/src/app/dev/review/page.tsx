import type { Metadata } from "next"

import { canUseReview } from "@/lib/server/review"

import { ReviewLoader } from "./loader"

export const metadata: Metadata = { title: "Design review · Fillrate", robots: { index: false } }

// M2 design review for the primary user. The link carries `?key=` (REVIEW_KEY) so answers can be saved.
export default async function ReviewPage({ searchParams }: PageProps<"/dev/review">) {
  const key = (await searchParams).key
  const reviewKey = typeof key === "string" ? key : null
  return <ReviewLoader reviewKey={reviewKey} canSave={canUseReview(reviewKey)} />
}
