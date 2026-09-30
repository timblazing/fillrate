"use client"

import { useTheme } from "next-themes"

import Earth from "@/components/ui/globe"
import { useCssColors } from "@/lib/css-color"

type Rgb = [number, number, number]

const TOKENS = ["--route-1", "--muted-foreground"] as const

// cobe paints on WebGL and wants [r, g, b] in 0..1, so convert resolved rgb() tokens.
function toRgb(color: string | undefined): Rgb | null {
  const match = color?.match(/\d+(\.\d+)?/g)
  if (!match || match.length < 3) return null
  return [Number(match[0]) / 255, Number(match[1]) / 255, Number(match[2]) / 255]
}

export default function HeroGlobe() {
  const { resolvedTheme } = useTheme()
  const colors = useCssColors(TOKENS, resolvedTheme)
  const accent = toRgb(colors["--route-1"])
  const base = toRgb(colors["--muted-foreground"])
  const isDark = resolvedTheme === "dark"

  return (
    <div aria-hidden className="aspect-square w-full max-w-[480px]">
      {accent && base && (
        <Earth
          // cobe reads its options once, so remount when the theme changes.
          key={`${resolvedTheme}-${colors["--route-1"]}`}
          className="max-w-none"
          scale={1}
          dark={isDark ? 1 : 0}
          diffuse={isDark ? 1.2 : 2}
          mapBrightness={isDark ? 6 : 8}
          baseColor={isDark ? base : [1, 1, 1]}
          markerColor={accent}
          glowColor={isDark ? accent : [0.9, 0.93, 1]}
        />
      )}
    </div>
  )
}
