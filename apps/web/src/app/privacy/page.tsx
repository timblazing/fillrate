import { PublicHeader } from "@/components/brand/public-header"

export const metadata = { title: "Data and privacy · Fillrate" }

// Spec §14 disclosures for the hosted service: what is stored, retention, deletion, backups and geocoding.
export default function PrivacyPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-8 text-sm text-pretty sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Data and privacy</h1>
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">What is stored</h2>
          <p>Signing in with GitHub stores your GitHub name, email address and avatar link, a session record and the GitHub account link. Fillrate does not post to GitHub or read your repositories.</p>
          <p>The owner sees your request note and GitHub profile details to decide whether to grant access.</p>
          <p>Scenarios you import (orders, stock, locations and addresses), their versions, runs, sweeps, results, geocoding answers and travel snapshots are stored in the server&apos;s database and belong to your account. Other accounts cannot list, open or reuse them, whatever their IDs or content hashes.</p>
        </section>
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">Retention and deletion</h2>
          <p>Your data stays until you delete it. Deleting a scenario removes its versions, branches, runs and sweeps at once. Deleting your account removes everything it owns, its sessions and the GitHub link. Download your data from the account page first if you want a copy.</p>
          <p>The server keeps database backups for recovery. A deleted item remains in backups made before the deletion until those backups expire, at most 30 days later, and is not restored into the service.</p>
        </section>
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">Geocoding</h2>
          <p>When you geocode addresses, they are sent to the U.S. Census Bureau geocoder (no account or key). ZIP code fallbacks use a lookup table on the server and send nothing. Answers are cached for your account only.</p>
        </section>
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">Limits and logs</h2>
          <p>Free accounts have daily limits on solves, geocoding, saves and uploads, shown on the account page. Server logs record job IDs, timings and error codes, not addresses or tokens.</p>
          <p>Lessons and bundled examples use synthetic data. On the hosted service, product pages require sign-in and approved access.</p>
        </section>
      </main>
    </div>
  )
}
