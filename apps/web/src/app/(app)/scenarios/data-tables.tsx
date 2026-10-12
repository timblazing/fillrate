import { useMemo } from "react"
import type { ScenarioDocument } from "@fillrate/contracts"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EditCell } from "./workbench-ui"

const PAGE_SIZE = 25

/** Parse a nonnegative amount with at most two decimals into integer hundredths. */
function decimal(raw: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error("Use at most two decimal places.")
  const [whole, fraction = ""] = raw.split(".")
  const n = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"))
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Value is too large.")
  return Number(n)
}

/** The editable order-line and inventory tables, with paging. */
export function DataTables({
  doc,
  tab,
  page,
  setPage,
  changeDocument,
}: {
  doc: ScenarioDocument
  tab: string
  page: number
  setPage: (page: number) => void
  changeDocument: (fn: (draft: ScenarioDocument) => void) => void
}) {
  const lines = useMemo(() => doc.orders.flatMap((order, oi) => order.lines.map((line, li) => ({ order, line, oi, li }))), [doc])
  const count = tab === "orders" ? lines.length : tab === "inventory" ? doc.inventory.length : doc.locations.length
  const headers = tab === "orders" ? ["Order", "Date", "Product", "Pieces", "Value / piece ($)", "Feet / piece"] : ["Product", "Available pieces"]
  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {headers.map(h => (
                <TableHead key={h}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {tab === "orders" &&
              lines.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(({ order, line, oi, li }) => (
                <TableRow key={line.id}>
                  <TableCell>{order.id}</TableCell>
                  <TableCell>
                    <EditCell
                      label={`Date ${order.id}`}
                      value={order.order_date}
                      onCommit={value =>
                        changeDocument(d => {
                          d.orders[oi].order_date = value
                        })
                      }
                    />
                  </TableCell>
                  <TableCell>{line.product_id}</TableCell>
                  <TableCell>
                    <EditCell
                      label={`Pieces ${line.id}`}
                      value={line.ordered_pieces}
                      onCommit={value =>
                        changeDocument(d => {
                          if (!/^\d+$/.test(value)) throw new Error("Pieces must be a nonnegative whole number.")
                          d.orders[oi].lines[li].ordered_pieces = Number(value)
                        })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <EditCell
                      label={`Value ${line.id}`}
                      value={(line.net_value_per_piece_cents / 100).toFixed(2)}
                      onCommit={value =>
                        changeDocument(d => {
                          d.orders[oi].lines[li].net_value_per_piece_cents = decimal(value)
                        })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <EditCell
                      label={`Feet ${line.id}`}
                      value={((line.linear_feet_per_piece ?? doc.products.find(p => p.id === line.product_id)!.linear_feet_per_piece) / 100).toFixed(2)}
                      onCommit={value =>
                        changeDocument(d => {
                          d.orders[oi].lines[li].linear_feet_per_piece = decimal(value)
                        })
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
            {tab === "inventory" &&
              doc.inventory.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((item, index) => (
                <TableRow key={item.product_id}>
                  <TableCell>{item.product_id}</TableCell>
                  <TableCell>
                    <EditCell
                      label={`Available ${item.product_id}`}
                      value={item.available_pieces}
                      onCommit={value =>
                        changeDocument(d => {
                          if (!/^\d+$/.test(value)) throw new Error("Stock must be a nonnegative whole number.")
                          d.inventory[page * PAGE_SIZE + index].available_pieces = Number(value)
                        })
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" disabled={!page} onClick={() => setPage(page - 1)}>
          Previous
        </Button>
        <span className="text-sm text-muted-foreground tabular-nums">
          {count ? page * PAGE_SIZE + 1 : 0}–{Math.min((page + 1) * PAGE_SIZE, count)} of {count}
        </span>
        <Button variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= count} onClick={() => setPage(page + 1)}>
          Next
        </Button>
      </div>
    </>
  )
}
