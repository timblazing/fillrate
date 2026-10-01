"use client"

import dynamic from "next/dynamic"

// The form reads its draft from localStorage, so it renders on the client only.
export const ReviewLoader = dynamic(() => import("./review").then((m) => m.Review), { ssr: false })
