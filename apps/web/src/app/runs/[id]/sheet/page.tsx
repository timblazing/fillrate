import { headers } from "next/headers"
import { notFound } from "next/navigation"

import { initializeDatabase } from "@/lib/server/database"
import { assertRunReadAccess } from "@/lib/server/scenarios"
import { ApiError, runDetail } from "@/lib/server/runs"
import { type SheetColumn, shipmentSheets } from "@/lib/shipment-sheet"

import { SheetView } from "./sheet-view"

export const dynamic = "force-dynamic"
export const metadata = { title: "Shipment sheets · Fillrate" }

// Printable shipment sheets (spec v1.8 §15 M2 item 11): one shipment per page, black-and-white safe, no map.
// ?shipment=<truck id> prints one; ?columns=location,pieces adds the optional columns.
export default async function SheetPage({ params, searchParams }: PageProps<"/runs/[id]/sheet">) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  let detail
  try {
    const store = initializeDatabase()
    assertRunReadAccess(store, id, new Request("http://localhost/sheet", {headers:{cookie:(await headers()).get("cookie") ?? ""}}))
    detail = runDetail(store, id)
  } catch (error) {
    // Imported runs without operator access read as missing, so their existence is not revealed.
    if (error instanceof ApiError && [403, 404, 503].includes(error.status)) notFound()
    throw error
  }
  if (!detail.summary) notFound()
  const one = typeof query.shipment === "string" ? query.shipment : null
  const columns = (typeof query.columns === "string" ? query.columns : "").split(",").filter((c): c is SheetColumn => c === "location" || c === "pieces")
  const all = shipmentSheets(detail.summary)
  const sheets = one ? all.filter((s) => s.truckId === one) : all
  if (!sheets.length) notFound()
  const products = Object.fromEntries(detail.summary.products.map((p) => [p.product_id, p.label]))
  return (
    <SheetView
      runId={detail.id}
      scenario={detail.summary.scenario_name}
      depot={detail.summary.depot.label}
      circuity={detail.summary.settings.travel_circuity}
      capacity={detail.summary.settings.trailer_capacity}
      sheets={sheets}
      total={all.length}
      shipment={one}
      columns={columns}
      products={products}
    />
  )
}
