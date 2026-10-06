import { notFound } from "next/navigation"

import { initializeDatabase } from "@/lib/server/database"
import { assertRunRead, pagePrincipal } from "@/lib/server/access"
import { ApiError, runDetail } from "@/lib/server/runs"
import { type SheetColumn, shipmentSheets } from "@/lib/shipment-sheet"
import { travelBasis } from "@/lib/units"

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
    assertRunRead(store, await pagePrincipal(), id)
    detail = runDetail(store, id)
  } catch (error) {
    // Another owner's runs read as missing, so their existence is not revealed.
    if (error instanceof ApiError && [403, 404].includes(error.status)) notFound()
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
      milesNote={travelBasis(detail.summary.travel, detail.summary.settings.travel_circuity).sentence}
      sheets={sheets}
      total={all.length}
      shipment={one}
      columns={columns}
      products={products}
    />
  )
}
