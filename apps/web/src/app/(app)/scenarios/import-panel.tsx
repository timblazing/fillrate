import { ChevronDownIcon } from "lucide-react"
import type { CsvImportInput, CsvImportPreview, ImportFormat, InventoryColumn, OrderColumn } from "@fillrate/db/imports"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { DataReviewPanel } from "./data-review"
import { Field, Section, download } from "./workbench-ui"

const orderColumns: OrderColumn[] = [
  "order_id",
  "line_id",
  "order_date",
  "customer_id",
  "location_id",
  "location_label",
  "address",
  "latitude",
  "longitude",
  "product",
  "ordered_pieces",
  "net_value_per_piece",
  "linear_feet_per_piece",
  "priority",
]
const inventoryColumns: InventoryColumn[] = ["product", "available_pieces"]
const templates = {
  orders: `${orderColumns.join(",")}\nO-1,L-1,2026-09-30,ACME,C-1,Customer 1,,35.1,-90.1,SKU-1,10,12.50,1.25,1\nO-2,L-2,2026-09-30,Beta,C-2,Beta Yard,"125 N Main St, Memphis, TN 38103",,,SKU-1,4,12.50,1.25,1\n`,
  inventory: "product,available_pieces\nSKU-1,100\n",
}
// GeoJSON points use the CSV column names as properties; geometry is [longitude, latitude] or null for address-only stops.
const geojsonTemplate = JSON.stringify(
  {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-90.1, 35.1] },
        properties: {
          order_id: "O-1",
          line_id: "L-1",
          order_date: "2026-09-30",
          customer_id: "ACME",
          location_id: "C-1",
          location_label: "Customer 1",
          product: "SKU-1",
          ordered_pieces: 10,
          net_value_per_piece: "12.50",
          linear_feet_per_piece: "1.25",
          priority: 1,
        },
      },
      {
        type: "Feature",
        geometry: null,
        properties: {
          order_id: "O-2",
          line_id: "L-2",
          order_date: "2026-09-30",
          customer_id: "Beta",
          location_id: "C-2",
          location_label: "Beta Yard",
          address: "125 N Main St, Memphis, TN 38103",
          product: "SKU-1",
          ordered_pieces: 4,
          net_value_per_piece: "12.50",
          linear_feet_per_piece: "1.25",
          priority: 1,
        },
      },
    ],
  },
  null,
  1,
)
const formats: [ImportFormat, string][] = [
  ["csv", "CSV"],
  ["geojson", "GeoJSON points"],
  ["json", "Scenario JSON"],
]

/** A file picker and a paste box for one import text. */
function TextSource({
  label,
  accept,
  value,
  limit,
  onRead,
  onError,
}: {
  label: string
  accept: string
  value: string
  limit: number
  onRead: (text: string) => void
  onError: (message: string) => void
}) {
  return (
    <>
      <Input
        aria-label={`${label} file`}
        type="file"
        accept={accept}
        onChange={async e => {
          const file = e.target.files?.[0]
          if (!file) return
          if (file.size > limit) {
            onError(`${label} exceeds ${limit / 1_000_000} MB.`)
            return
          }
          onRead(await file.text())
        }}
      />
      <Textarea
        aria-label={`${label} content`}
        className="[&_textarea]:field-sizing-fixed [&_textarea]:min-h-32 [&_textarea]:font-mono [&_textarea]:text-xs"
        placeholder={`Paste ${label} here`}
        value={value}
        onChange={e => onRead(e.target.value)}
      />
    </>
  )
}

function formatHelp(format: ImportFormat) {
  if (format === "json") return "A scenario JSON file, as written by Export JSON. Its name, depot, orders, stock and coordinate provenance are used as they are."
  if (format === "geojson") {
    return "A GeoJSON FeatureCollection of points. Each feature's properties use the order-line CSV column names; the Point geometry ([longitude, latitude]) gives the coordinates, or use a null geometry and an address property. Stock is a CSV."
  }
  return "Order lines and stock as CSV. Dollars and feet accept up to two decimals; quantities are whole pieces."
}

/** The "Import" section: choose a format, supply data, preview, then save as a new scenario. */
export function ImportPanel({
  input,
  depotRaw,
  preview,
  busy,
  dirty,
  depotValid,
  importReady,
  onChange,
  onDepotRaw,
  onPreview,
  onSave,
  onError,
}: {
  input: CsvImportInput
  depotRaw: { lat: string; lon: string }
  preview: CsvImportPreview | null
  busy: boolean
  dirty: boolean
  depotValid: boolean
  importReady: boolean
  onChange: (patch: Partial<CsvImportInput>) => void
  onDepotRaw: (patch: Partial<{ lat: string; lon: string }>) => void
  onPreview: () => void
  onSave: () => void
  onError: (message: string) => void
}) {
  const format = input.format ?? "csv"
  return (
    <Section
      title="Import"
      action={
        <ToggleGroup
          aria-label="Import format"
          variant="outline"
          size="sm"
          className="flex-wrap"
          value={[format]}
          onValueChange={next => {
            if (next[0]) onChange({ format: next[0] as ImportFormat })
          }}
        >
          {formats.map(([value, label]) => (
            <ToggleGroupItem key={value} value={value}>
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      }
    >
      <p className="text-sm text-muted-foreground">
        {formatHelp(format)} Preview is non-destructive. Addresses without coordinates are kept and can be resolved after saving (Census, then the ZIP
        fallback). A ZIP code and a Census ZCTA are different: the ZCTA only approximates the ZIP&apos;s area.
      </p>
      {format !== "json" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Scenario name">
            <Input value={input.name} onChange={e => onChange({ name: e.target.value })} />
          </Field>
          <Field label="Depot label">
            <Input
              placeholder="e.g. Memphis DC"
              value={input.depot.label}
              onChange={e => onChange({ depot: { ...input.depot, label: e.target.value } })}
            />
          </Field>
          <Field label="Depot latitude">
            <Input
              type="number"
              step="any"
              placeholder="e.g. 35.1495"
              value={depotRaw.lat}
              onChange={e => {
                onDepotRaw({ lat: e.target.value })
                onChange({ depot: { ...input.depot, lat: e.target.value.trim() === "" ? Number.NaN : Number(e.target.value) } })
              }}
            />
          </Field>
          <Field label="Depot longitude">
            <Input
              type="number"
              step="any"
              placeholder="e.g. -90.049"
              value={depotRaw.lon}
              onChange={e => {
                onDepotRaw({ lon: e.target.value })
                onChange({ depot: { ...input.depot, lon: e.target.value.trim() === "" ? Number.NaN : Number(e.target.value) } })
              }}
            />
          </Field>
        </div>
      )}
      {format === "json" ? (
        <TextSource
          label="Scenario JSON"
          accept=".json,application/json"
          value={input.scenarioJson ?? ""}
          limit={10_000_000}
          onRead={text => onChange({ scenarioJson: text })}
          onError={onError}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {(["orders", "inventory"] as const).map(kind => {
            const geo = kind === "orders" && format === "geojson"
            const field = geo ? "ordersGeojson" : kind === "orders" ? "ordersCsv" : "inventoryCsv"
            return (
              <div className="min-w-0 space-y-3" key={kind}>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">{kind === "orders" ? (geo ? "Order lines (GeoJSON)" : "Order lines") : "Inventory"}</h3>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      geo ? download("orders-template.geojson", geojsonTemplate, "application/geo+json") : download(`${kind}-template.csv`, templates[kind])
                    }
                  >
                    Download template
                  </Button>
                </div>
                <TextSource
                  label={geo ? "orders GeoJSON" : `${kind} CSV`}
                  accept={geo ? ".geojson,.json,application/geo+json,application/json" : ".csv,text/csv"}
                  value={input[field] ?? ""}
                  limit={5_000_000}
                  onRead={text => onChange({ [field]: text })}
                  onError={onError}
                />
                {!geo && (
                  <Collapsible>
                    <CollapsibleTrigger className="group flex cursor-pointer items-center gap-1.5 rounded-md text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      Column mapping
                      <ChevronDownIcon className="size-4 transition-transform group-data-[panel-open]:rotate-180" aria-hidden />
                    </CollapsibleTrigger>
                    <CollapsiblePanel>
                      <div className="grid p-1 pt-3 gap-2 sm:grid-cols-2">
                        {(kind === "orders" ? orderColumns : inventoryColumns).map(column => (
                          <Field key={column} label={column.replaceAll("_", " ")}>
                            <Input
                              placeholder={column}
                              value={(kind === "orders" ? input.orderMapping : input.inventoryMapping)?.[column as never] ?? ""}
                              onChange={e =>
                                onChange(
                                  kind === "orders"
                                    ? { orderMapping: { ...input.orderMapping, [column]: e.target.value || undefined } }
                                    : { inventoryMapping: { ...input.inventoryMapping, [column]: e.target.value || undefined } },
                                )
                              }
                            />
                          </Field>
                        ))}
                      </div>
                    </CollapsiblePanel>
                  </Collapsible>
                )}
              </div>
            )
          })}
        </div>
      )}
      {format !== "json" && !depotValid && (
        <p className="text-muted-foreground text-sm">
          Enter the depot label and its latitude and longitude (decimal degrees) to preview. There is no default depot.
        </p>
      )}
      <Button disabled={busy || !importReady} onClick={onPreview}>
        Preview import
      </Button>
      {preview && <PreviewResult preview={preview} busy={busy} dirty={dirty} onSave={onSave} />}
    </Section>
  )
}

function PreviewResult({ preview, busy, dirty, onSave }: { preview: CsvImportPreview; busy: boolean; dirty: boolean; onSave: () => void }) {
  const issues = [...preview.errors.map(item => ({ item, error: true })), ...preview.warnings.map(item => ({ item, error: false }))]
  return (
    <div className="space-y-3">
      <p className="font-medium">
        {preview.valid
          ? `${preview.document?.name}: ${preview.document?.orders.length} orders ready to save`
          : `${preview.errors.length} import ${preview.errors.length === 1 ? "error" : "errors"}: fix these and preview again`}
        {preview.warnings.length > 0 ? ` · ${preview.warnings.length} ${preview.warnings.length === 1 ? "notice" : "notices"}` : ""}
      </p>
      {issues.slice(0, 50).map(({ item, error }, i) => (
        <p className={`rounded-lg border px-3 py-2 text-sm ${error ? "border-destructive/40 text-destructive-foreground" : "text-muted-foreground"}`} key={i}>
          <span className="font-medium">{error ? "Error" : "Notice"} · </span>
          {item.file === "scenario" ? "Scenario" : `${item.file} ${preview.format === "geojson" && item.file === "orders" ? "feature" : "row"} ${item.row}`}
          {item.column ? `, ${item.column}` : ""}: {item.message}
        </p>
      ))}
      {issues.length > 50 && <p className="text-muted-foreground text-sm">Showing the first 50 of {issues.length}.</p>}
      {preview.review && <DataReviewPanel review={preview.review} />}
      {Object.entries(preview.samples).map(
        ([kind, rows]) =>
          rows.length > 0 && (
            <div key={kind} className="overflow-x-auto">
              <h3 className="text-sm font-medium">{kind} sample</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    {Object.keys(rows[0] ?? {}).map(h => (
                      <TableHead key={h}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={i}>
                      {Object.entries(row).map(([h, value]) => (
                        <TableCell key={h}>{value}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ),
      )}
      <Button disabled={busy || !preview.valid || dirty} onClick={onSave}>
        Save import
      </Button>
    </div>
  )
}
