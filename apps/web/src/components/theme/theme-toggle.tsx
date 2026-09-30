"use client"

import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { useSyncExternalStore } from "react"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  // The stored theme is only known on the client; render no selection until mounted.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )

  return (
    <ToggleGroup
      variant="outline"
      size="sm"
      value={mounted && theme ? [theme] : []}
      onValueChange={(value) => value[0] && setTheme(value[0])}
      aria-label="Theme"
    >
      <ToggleGroupItem value="light" aria-label="Light theme">
        <Sun />
      </ToggleGroupItem>
      <ToggleGroupItem value="dark" aria-label="Dark theme">
        <Moon />
      </ToggleGroupItem>
      <ToggleGroupItem value="system" aria-label="System theme">
        <Monitor />
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
