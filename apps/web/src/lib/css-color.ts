"use client"

import { useEffect, useState } from "react"

// MapLibre paints on a canvas and cannot read CSS variables or oklch(), so resolve
// design tokens to rgb() strings. Re-resolves when `key` (e.g. the theme) changes.
export function resolveCssColor(token: string): string {
  const probe = document.createElement("span")
  probe.style.color = `var(${token})`
  document.body.appendChild(probe)
  const computed = getComputedStyle(probe).color
  probe.remove()

  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })
  if (!ctx) return computed
  ctx.fillStyle = computed
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
  return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`
}

export function useCssColors(tokens: readonly string[], key?: string): Record<string, string> {
  const [colors, setColors] = useState<Record<string, string>>({})
  const tokenKey = tokens.join("|")

  useEffect(() => {
    // Wait a frame so a theme class change has applied before reading styles.
    const frame = requestAnimationFrame(() => {
      setColors(Object.fromEntries(tokenKey.split("|").map((t) => [t, resolveCssColor(t)])))
    })
    return () => cancelAnimationFrame(frame)
  }, [tokenKey, key])

  return colors
}
