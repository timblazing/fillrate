import { DevHeader } from "@/components/brand/dev-header"
import { ScenarioWorkbench } from "./scenario-workbench"
export const metadata = { title: "Scenarios · Fillrate" }
export default function ScenariosPage() {
  return <div className="min-h-dvh"><DevHeader /><main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6"><div><h1 className="text-2xl font-semibold">Scenarios</h1><p className="text-muted-foreground mt-2 text-sm">Import orders and stock, resolve data, save a version, then run the fulfillment pipeline.</p></div><ScenarioWorkbench /></main></div>
}
