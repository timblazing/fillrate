"use client"

import { useTheme } from "next-themes"

import Earth from "@/components/ui/globe"
import { useCssColors } from "@/lib/css-color"

type Rgb = [number, number, number]

const REPO_URL = "https://github.com/timblazing/fillrate"
const TOKENS = ["--route-1", "--muted-foreground"] as const

// cobe paints on WebGL and wants [r, g, b] in 0..1, so convert resolved rgb() tokens.
function toRgb(color: string | undefined): Rgb | null {
  const match = color?.match(/\d+(\.\d+)?/g)
  if (!match || match.length < 3) return null
  return [Number(match[0]) / 255, Number(match[1]) / 255, Number(match[2]) / 255]
}

export default function GlobeLink() {
  const { resolvedTheme } = useTheme()
  const colors = useCssColors(TOKENS, resolvedTheme)
  const accent = toRgb(colors["--route-1"])
  const base = toRgb(colors["--muted-foreground"])
  const isDark = resolvedTheme === "dark"

  return (
    <a
      href={REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Fillrate on GitHub"
      className="focus-visible:ring-ring block aspect-square w-full max-w-[480px] rounded-full transition-transform duration-700 outline-none hover:scale-105 focus-visible:ring-2"
    >
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
    </a>
  )
}
