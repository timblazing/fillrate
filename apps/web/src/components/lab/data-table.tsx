"use client"

import {
  type ColumnDef,
  type RowData,
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  tableFeatures,
  useTable,
} from "@tanstack/react-table"
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react"
import { useState } from "react"

import { Checkbox } from "@/components/ui/checkbox"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"

export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric },
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { includesString: filterFn_includesString },
  rowSelectionFeature,
})

export type DataTableColumn<T extends RowData> = ColumnDef<typeof dataTableFeatures, T, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export function dataTableColumns<T extends RowData>() {
  return createColumnHelper<typeof dataTableFeatures, T>()
}

// TanStack Table v9 + shadcn Table (spec §2). Rows are keyed by stable ID so selection syncs with map/timeline.
export function DataTable<T extends { id: string }>({
  columns,
  data,
  selected,
  onSelectedChange,
  toolbar,
  filterPlaceholder = "Filter…",
  className,
}: {
  columns: DataTableColumn<T>[]
  data: T[]
  selected?: string | null
  onSelectedChange?: (id: string | null) => void
  toolbar?: React.ReactNode
  filterPlaceholder?: string
  className?: string
}) {
  const [filter, setFilter] = useState("")

  const table = useTable({
    features: dataTableFeatures,
    data,
    columns: [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            aria-label="Select all"
            checked={table.getIsAllRowsSelected()}
            indeterminate={table.getIsSomeRowsSelected() && !table.getIsAllRowsSelected()}
            onCheckedChange={(v) => table.toggleAllRowsSelected(!!v)}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            aria-label={`Select ${row.id}`}
            checked={row.getIsSelected()}
            onCheckedChange={(v) => row.toggleSelected(!!v)}
            onClick={(e) => e.stopPropagation()}
          />
        ),
        enableSorting: false,
      },
      ...columns,
    ],
    getRowId: (row) => row.id,
    globalFilterFn: "includesString",
    state: { globalFilter: filter },
    onGlobalFilterChange: (v) => setFilter(typeof v === "function" ? v(filter) : v),
  })

  const count = Object.keys(table.state.rowSelection).length

  return (
    <div className={cn("overflow-hidden rounded-xl border", className)}>
      <div className="flex flex-wrap items-center gap-2 border-b p-2">
        <InputGroup className="h-8 w-56">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={filterPlaceholder} />
        </InputGroup>
        {toolbar}
        <span className="text-muted-foreground ml-auto pr-1 text-xs tabular-nums">
          {count > 0 ? `${count} selected · ` : ""}
          {table.getRowModel().rows.length} of {data.length} rows
        </span>
      </div>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted()
                return (
                  <TableHead key={header.id} className={cn(header.id === "select" && "w-8")}>
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="hover:text-foreground -ml-1 inline-flex items-center gap-1 rounded px-1 transition-colors"
                      >
                        <table.FlexRender header={header} />
                        {sorted === "asc" ? (
                          <ArrowUp className="size-3" />
                        ) : sorted === "desc" ? (
                          <ArrowDown className="size-3" />
                        ) : (
                          <ArrowUpDown className="size-3 opacity-40" />
                        )}
                      </button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              data-state={row.id === selected || row.getIsSelected() ? "selected" : undefined}
              onClick={() => onSelectedChange?.(row.id === selected ? null : row.id)}
              className={cn("cursor-pointer", row.id === selected && "shadow-[inset_2px_0_0_var(--foreground)]")}
            >
              {row.getAllCells().map((cell) => (
                <TableCell key={cell.id}>
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
          {table.getRowModel().rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={columns.length + 1} className="text-muted-foreground h-20 text-center">
                No rows match “{filter}”.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
