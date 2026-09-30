"use client"

import { dataTableColumns } from "@/components/lab/data-table"
import { LineStateBadge } from "@/components/lab/line-state"
import { CoordinateSourceBadge } from "@/components/lab/provenance-badge"
import { TruckTag } from "@/components/lab/route-swatch"
import { formatMoney } from "@/lib/units"

import type { OrderRow } from "./fixtures/order-rows"

const col = dataTableColumns<OrderRow>()

export const orderColumns = col.columns([
  col.accessor("id", {
    header: "Line",
    cell: ({ row }) => (
      <span className="font-mono text-xs">
        {row.original.id}
        <span className="text-muted-foreground block text-[10px]">{row.original.orderDate}</span>
      </span>
    ),
  }),
  col.accessor("account", {
    header: "Account",
    cell: ({ row }) => (
      <span className="block max-w-44 truncate">
        {row.original.account}
        <span className="text-muted-foreground block text-xs">{row.original.city}</span>
      </span>
    ),
  }),
  col.accessor("product", {
    header: "Product",
    cell: ({ row }) => (
      <span className="block max-w-40 truncate">
        {row.original.product}
        <span className="text-muted-foreground block font-mono text-[10px]">SKU {row.original.sku}</span>
      </span>
    ),
  }),
  col.accessor("allocated", {
    header: "Pieces",
    cell: ({ row }) => (
      <span className="font-mono text-xs tabular-nums">
        {row.original.allocated}
        <span className="text-muted-foreground">/{row.original.ordered}</span>
      </span>
    ),
  }),
  col.accessor("feet", {
    header: "Lin. ft",
    cell: ({ getValue }) => <span className="font-mono text-xs tabular-nums">{(getValue() / 100).toFixed(1)}</span>,
  }),
  col.accessor("amount", {
    header: "Allocated",
    cell: ({ getValue }) => <span className="font-mono text-xs tabular-nums">{formatMoney(getValue())}</span>,
  }),
  col.accessor("state", {
    header: "State",
    enableGlobalFilter: false,
    cell: ({ row }) => (
      <span className="flex items-center gap-2">
        <LineStateBadge state={row.original.state} />
        {row.original.truck && row.original.cluster && <TruckTag id={row.original.truck} cluster={row.original.cluster} />}
      </span>
    ),
  }),
  col.accessor("source", {
    header: "Coordinates",
    enableGlobalFilter: false,
    cell: ({ getValue }) => <CoordinateSourceBadge source={getValue()} />,
  }),
])
