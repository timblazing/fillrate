import { SquareTerminal } from "lucide-react"
import Link from "next/link"

import HeroGlobe from "@/components/animated/hero-globe"
import { GitHubMark } from "@/components/brand/github-mark"
import { Button } from "@/components/ui/button"

const REPO_URL = "https://github.com/timblazing/fillrate"

export default function Home() {
  return (
    <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_minmax(0,480px)] lg:gap-16 lg:px-8">
      <div className="max-w-xl">
        <h1 className="text-5xl font-semibold tracking-tight text-balance sm:text-6xl">Fillrate</h1>
        <p className="text-muted-foreground mt-5 text-lg text-pretty">
          Plan fuller truckloads from limited stock. Fillrate allocates inventory to open orders, groups the stops, and builds
          loads with PyVRP, then explains every result.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button size="lg" render={<a href={REPO_URL} target="_blank" rel="noopener noreferrer" />}>
            <GitHubMark className="size-4" />
            GitHub
          </Button>
          <Button size="lg" variant="outline" render={<Link href="/dev" />}>
            <SquareTerminal />
            See my progress
          </Button>
        </div>
      </div>
      <div className="flex justify-center">
        <HeroGlobe />
      </div>
    </main>
  )
}
