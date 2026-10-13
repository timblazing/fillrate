# Fillrate product brief

Fillrate plans truckload shipments from scarce inventory. It is a small tool built for one real user (a friend who plans outbound loads) and anyone with the same problem. Keep it small.

## The workflow

One depot ships open orders on 53 ft trailers. Each run:

1. **Allocate** available inventory to open order lines, piece by piece: order date first, then net value per piece, then stable ID. An order line can be partly filled.
2. **Cluster** the allocated stops with k-means on latitude/longitude.
3. **Build loads** in each cluster with PyVRP. Linear feet are the only capacity, a cluster can need several trucks, routes are open (no return to the depot), and every leg (depot → first stop, stop → stop) must be at most 500 miles. Optional delivery time windows and service durations.
4. **Compare** runs on truck fill, cluster tightness, planned revenue, truck count and miles. Explore k and seeds to check that a grouping is stable.

The user's pain is interpreting raw solver output, so results must explain themselves: per-cluster and per-truck summaries, why each line did not ship, and side-by-side comparison. Every plan is checked by an independent validator.

## Confirmed rules

- Distance for optimization is **haversine × 1.2** miles. Road routing is never an input to the solver.
- Objective: fewest trucks, then fewest miles. The cost objective is optional; the user has no rates.
- Orders at the same delivery location combine into one stop only for the same customer.
- Addresses geocode through the free Census geocoder, with a ZIP (ZCTA) approximate fallback that is always labeled.
- Target size: about 2,000 open orders per scenario.
- Allocation is an experiment against an inventory snapshot, not a reservation. Linear feet are a one-dimensional model, not a packing or compliance claim.

## Direction (2026-10-08)

Fillrate is being simplified. Decisions:

- **Local is the full tool.** Docker or Bun from source, single user, no accounts, saved scenarios and runs in SQLite. Real or sensitive data belongs here.
- **The hosted site is a stateless playground.** The bundled sample opens a precomputed, independently validated plan without running the optimizer. Uploads run with hard caps on order count, solve time and concurrency; their data and results are never persisted. No accounts, quotas or access requests. One top bar switches between Inputs, Map, Shipments, Timeline, Unshipped, Stock and Details. Validation and compact plan totals live in the scenario sidebar; technical checks live in Details. The get-started dialog chooses the sample or CSV uploads, and the scenario edit button reopens it.
- **Roads are display only.** Inspecting a shipment automatically loads its road path and road miles from the public Valhalla server, with OpenStreetMap credit. The overview uses schematic connections; unavailable routing is explicitly labeled as an estimated fallback. No self-hosted Valhalla, road matrices, coverage limits or persistent geometry caches.
- **Kept pipeline features:** the core loop above, time windows and service durations, and the k/seed explorer.
- **Removed:** Learn lessons, Solver Lab, `/dev` progress pages and the component gallery, hosted auth/quotas/request access, CP-SAT allocation, mixed fleets, manual plans and warm starts, the durable job/lease/artifact-reuse machinery (replaced by direct solves), and the release-evidence process.
- The repository documents how to run Fillrate, not any particular deployment.

Remaining work is tracked in GitHub Issues and the [Fillrate work project](https://github.com/users/timblazing/projects/2).
