"use server"

import { refresh } from "next/cache"

import { initializeDatabase } from "@/lib/server/database"
import { canUseReview } from "@/lib/server/review"

// Removes one review response (e.g. the owner's own test answers). Same key as the responses page.
export async function deleteReview(id: string, key: string | null) {
  if (!canUseReview(key)) throw new Error("Not allowed.")
  initializeDatabase().deleteReview(id)
  refresh()
}
