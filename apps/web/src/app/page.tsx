import Link from "next/link"

import { Button } from "@/components/ui/button"

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">PyVRP Lab</h1>
      <p className="text-muted-foreground max-w-md text-sm">
        Frontend foundation only. The workbench arrives in milestone 3; see docs/progress.md.
      </p>
      {process.env.NODE_ENV !== "production" && (
        <Button variant="outline" render={<Link href="/dev/components" />}>
          Open component gallery
        </Button>
      )}
    </main>
  )
}
