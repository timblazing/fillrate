import { PublicHeader } from "@/components/brand/public-header"

export const metadata = { title: "Data and privacy · Fillrate" }

export default function PrivacyPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-8 text-sm text-pretty sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Data and privacy</h1>
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">What is stored</h2>
          <p>Fillrate has no accounts. The scenarios you import (orders, stock, locations and addresses), their versions, runs, sweeps, results and geocoding answers are stored in the SQLite database on the machine running the app. Deleting a scenario removes its versions, runs and sweeps.</p>
        </section>
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">Geocoding</h2>
          <p>When you choose Show road path on a shipment, your browser sends that shipment&apos;s depot and stop coordinates to the public Valhalla routing server (valhalla1.openstreetmap.de, run by FOSSGIS). Nothing is sent otherwise.</p>
          <p>When you geocode addresses, they are sent to the U.S. Census Bureau geocoder (no account or key). ZIP code fallbacks use a lookup table on the server and send nothing.</p>
        </section>
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">Logs</h2>
          <p>Server logs record job IDs, timings and error codes, not addresses or tokens. Bundled examples use synthetic data.</p>
        </section>
      </main>
    </div>
  )
}
