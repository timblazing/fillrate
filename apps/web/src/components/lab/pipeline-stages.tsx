"use client"

import { ChevronRight } from "lucide-react"
import { useSyncExternalStore } from "react"

import { cn } from "@/lib/utils"

const STEPS_PREF = "fillrate.steps.collapsed"
const STEPS_EVENT = "fillrate:steps-pref"

function subscribeSteps(onChange: () => void) {
  window.addEventListener("storage", onChange)
  window.addEventListener(STEPS_EVENT, onChange)
  return () => {
    window.removeEventListener("storage", onChange)
    window.removeEventListener(STEPS_EVENT, onChange)
  }
}

function stepsCollapsed() {
  try {
    return localStorage.getItem(STEPS_PREF) === "1"
  } catch {
    return false
  }
}

/**
 * The "Steps" section (design review `run.stages`): expanded by default during and after a run. Collapsing is a
 * per-browser preference remembered in localStorage; it never hides a failed step.
 */
export function StepsPanel({ children, actions, className }: { children: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  // Server render and first paint are expanded; a remembered "collapsed" applies after hydration.
  const open = !useSyncExternalStore(subscribeSteps, stepsCollapsed, () => false)
  const toggle = () => {
    try {
      localStorage.setItem(STEPS_PREF, open ? "1" : "0")
    } catch {}
    window.dispatchEvent(new Event(STEPS_EVENT))
  }
  return (
    <section className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="hover:text-foreground text-muted-foreground -ml-1 inline-flex items-center gap-1 rounded px-1 text-sm font-medium"
        >
          <ChevronRight className={cn("size-4 transition-transform duration-150", open && "rotate-90")} aria-hidden />
          Steps
        </button>
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
      {open && children}
    </section>
  )
}
