"use client"

import { FileUp } from "lucide-react"
import { useRef, useState } from "react"

import { cn } from "@/lib/utils"

// File drop target for CSV / canonical JSON / GeoJSON imports (spec §6). Parsing happens elsewhere.
export function ImportDropzone({
  accept = ".csv,.json,.geojson",
  onFile,
  className,
}: {
  accept?: string
  onFile?: (file: File) => void
  className?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [name, setName] = useState<string | null>(null)

  const take = (file?: File) => {
    if (!file) return
    setName(file.name)
    onFile?.(file)
  }

  return (
    <button
      type="button"
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        take(e.dataTransfer.files[0])
      }}
      className={cn(
        "group hover:border-foreground/30 hover:bg-muted/40 focus-visible:ring-ring/50 flex w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-8 text-center transition-colors focus-visible:ring-3 focus-visible:outline-none",
        dragging && "border-info bg-info/5",
        className
      )}
    >
      <span
        className={cn(
          "bg-muted flex size-11 items-center justify-center rounded-xl border transition-transform duration-200 group-hover:-translate-y-0.5",
          dragging && "bg-info/10 text-info-foreground -translate-y-0.5"
        )}
      >
        <FileUp className="size-5" />
      </span>
      <span className="space-y-1">
        <span className="block text-sm font-medium">{name ?? "Drop a file or click to browse"}</span>
        <span className="text-muted-foreground block text-xs">CSV, scenario JSON, or GeoJSON points · nothing is saved until you confirm</span>
      </span>
      <input
        ref={input}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => take(e.target.files?.[0])}
      />
    </button>
  )
}
