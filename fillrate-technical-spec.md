# Fillrate — Technical Specification

Version: 1.4 · Prepared September 29, 2026

Revision notes:

- 1.1 replaces Neon PostgreSQL with a local SQLite file, packages the app as a single GHCR container image, and adds a GitHub Actions build workflow. The application requires no third-party credentials.
- 1.2 closes the remaining open decisions: Node LTS server runtime with `better-sqlite3`, network-level access control with no in-app auth, optional self-hosted single-state OSRM, public repository and image, Census ZCTA Gazetteer fallback, single-day time model, mapcn default basemap, concrete allocation heuristics, cost units, CI, and cross-session handoff documents.
- 1.3 re-centers the product on the primary user's fulfillment workflow: piece-level inventory allocation (order date, then value), k-means clustering of allocated stops, then PyVRP truckloads per cluster (53 ft trailers, linear feet only, open routes, a 500-mile limit), iterated and compared on truck fill, cluster tightness, and revenue, with a k explorer for picking a stable cluster count. Piece-level (partial) allocation moves into v1. Haversine × circuity factor becomes the main travel mode. Limits are scaled for about 2,000 open orders. Milestones are reordered so the pipeline comes first; the generic PyVRP feature tour moves to later milestones and lessons. This note also records the earlier switch from shadcn/ui to coss ui (Base UI) in §2, §15, §18, and §19.
- 1.4 renames the project from PyVRP Lab to **Fillrate** (repository `timblazing/fillrate`, image `ghcr.io/timblazing/fillrate`, database file `fillrate.sqlite`). The name covers both halves of the product: inventory fill rate (how much ordered demand stock can cover) and truck fill. PyVRP stays the routing solver under the hood, alongside OR-Tools and scikit-learn. The reference deployment is served at `fillrate.blasingame.dev` (§14). No behavior changes.

Status: implementation specification for alternating Codex and Claude Code sessions. There are no open product or stack decisions. Choices made during implementation (exact version pins, the OSRM state, and similar) are recorded in `docs/decisions.md` (see §18). The spec changes only through a new revision note.

## 1. Product definition

Fillrate is an in-depth private web workbench for planning and comparing order-fulfillment shipments: allocate scarce inventory to open orders, group the stops, and build full truckloads, using real optimization runs. Open-source PyVRP builds the loads; OR-Tools and scikit-learn handle allocation and clustering. The initial users are Clay and a friend who already uses PyVRP and Census address geocoding with ZIP fallback. Support synthetic examples and real order data. Inventory scarcity is a first-class experiment area.

### Primary workflow (the friend's use case)

One depot ships open orders on 53 ft trailers. Each run:

1. **Allocate** available inventory to open order lines, piece by piece: order date first, then value (§8).
2. **Cluster** the allocated stops geographically with k-means on latitude/longitude (§8a).
3. **Build loads** inside each cluster with PyVRP. Linear feet are the only load limit, a cluster can need several trucks, routes are open (the truck does not return to the depot), and no two stops in a cluster or consecutive stops may be more than 500 miles apart (§3, §7).
4. **Iterate** over combinations of stops, orders, and inventory, and compare runs on **truck fill**, **cluster tightness**, and **revenue** (allocated amount).

The friend's current pain is manually interpreting the output. Results must explain themselves: per-cluster and per-truck summaries, why each line did not ship, and side-by-side iteration comparison (§10).

Scenario workflow: create/import orders, inventory, and locations → inspect data quality → configure trailers and limits → allocate → cluster → build loads → inspect map, cluster cards, loads, and metrics → branch assumptions and compare iterations → export reproducible Python and data.

The general PyVRP capabilities (time windows, shipments, reloads, multiple depots, road matrices, and the rest of §3) remain in scope, but as later milestones and lessons (§13, §15), not the primary flow.

Design for about 2,000 open orders per scenario. Clustering splits routing into per-cluster PyVRP solves; each solve is bounded by `MAX_STOPS` (default 500 stops per cluster solve) and each scenario by `MAX_ORDERS` (default 5,000 orders). These are target workloads, not promised latencies. Measure allocation, clustering, and solver performance on the deployment machine; documented tests must distinguish orders, order lines, locations, stops (visits), clusters, and matrix nodes.

The product is a research workbench, not a dispatching, live tracking, navigation, or regulatory compliance system. No paid PyVRP Enterprise code, license keys, disabled upsell controls, or enterprise-only features. All routing behavior exposed as PyVRP must be supported by the pinned open-source release.

## 2. Accepted stack and architecture

| Layer | Decision |
| --- | --- |
| Web | Next.js App Router, React, TypeScript |
| JavaScript tooling | Bun package manager and script runner; commit bun.lock |
| Server runtime | Node.js 24 LTS for the Next.js server, migrations, and Vitest |
| UI | coss ui (Base UI primitives, installed through the shadcn CLI `@coss` registry), Tailwind CSS, light/dark/system theme |
| Mapping | mapcn and its MapLibre GL integration |
| Geographic calculations | Turf.js, imported by module where practical |
| Road routing | OSRM Table and Route APIs through a server-side adapter |
| Optimization service | Python, FastAPI, Pydantic |
| Routing solver | Open-source PyVRP, pinned and capability-tested |
| Inventory optimizer | Open-source OR-Tools CP-SAT |
| Clustering | scikit-learn k-means with numpy, in the Python optimizer |
| Persistence | SQLite (WAL mode) file on a mounted data volume |
| Database definitions/access | Drizzle ORM and Drizzle Kit in TypeScript, SQLite dialect, `better-sqlite3` driver |
| Job execution | Python worker supervisor with isolated child processes |
| Server data state | TanStack Query |
| Editor state | Small Zustand store; immutable scenario snapshots |
| Charts/tables | shadcn Chart/Recharts and TanStack Table |
| Testing | Vitest (Node) for web/database code, pytest for the optimizer, Playwright for browser flows |
| Distribution | Single container image on GHCR built by GitHub Actions; Docker Compose; documented native development workflow |

Use a monorepo with apps/web, services/optimizer, packages/db, packages/contracts, examples, docs, and deployment directories. Do not add Redis, Kubernetes, a GIS server, or a second routing engine as baseline dependencies.

Next.js owns public application endpoints, internal-route authentication, database queries, and Drizzle migrations. Python owns mathematical modeling, validation/evaluation, solving, and worker process control. Only the Next.js process opens the SQLite file; Python never opens the database and does not maintain a parallel ORM schema. Drizzle is TypeScript software; do not claim it runs in FastAPI.

Python workers claim durable tasks from authenticated Next.js internal endpoints. Next.js executes transactional claim/lease operations in SQLite via Drizzle. Worker result/progress calls also go through those endpoints. FastAPI provides internal health, capability, validation, and route-evaluation endpoints; the supervisor starts alongside it. These services bind to localhost inside the container and are never exposed directly to browsers.

Bun installs dependencies and runs scripts (`bun install`, `bun run …`). The Next.js server runs on Node.js 24 LTS: `next dev` in development, and the standalone `server.js` in the container. That makes `better-sqlite3` through `drizzle-orm/better-sqlite3` the database driver. Do not use Bun-only APIs such as `bun:sqlite` or `Bun.*` in application code. On every connection, set `journal_mode=WAL`, `foreign_keys=ON`, `synchronous=NORMAL`, and a `busy_timeout` of a few seconds. Job claims run in a `BEGIN IMMEDIATE` transaction (`db.transaction(fn, { behavior: "immediate" })`) that selects the oldest claimable job and updates it with `UPDATE … RETURNING`. SQLite serializes writers, so this provides the exclusivity that `FOR UPDATE SKIP LOCKED` would provide in Postgres. Keep write transactions short, and never hold one across solver or network work. Apply Drizzle migrations at container start, before the server accepts traffic. Do not copy preview/RC installation commands blindly: prefer compatible stable releases.

MapLibre and editor/chart code are client components and dynamically loaded where useful. Secrets, Drizzle, geocoding calls, and OSRM requests remain server-side. Generate a TypeScript API client/types from FastAPI OpenAPI; validate public inputs in TypeScript and independently in Python at the solver boundary.

## 3. Feature boundaries and capability discovery

Research baseline: stable PyVRP documentation identified version 0.14.0. In milestone 1, pin the latest stable releases (0.14.0 or newer for PyVRP) of Next.js, React, Drizzle, Python 3.13, PyVRP, OR-Tools, scikit-learn, numpy, FastAPI, and Pydantic. Record each exact version in `docs/decisions.md` and lock them with `bun.lock` and `uv.lock`. Upgrade a pin only through a recorded decision and a passing capability-fixture run. The repository main branch may contain different APIs. Build small executable capability fixtures before writing feature controls.

| Open-source feature | Required workbench behavior |
| --- | --- |
| Capacitated routing | Editable demand and vehicle capacity with route load inspection |
| Multiple load dimensions | Separate units, weight, volume, or user-defined resource capacities |
| Pickups/deliveries | Explicit visit actions and validated load transitions |
| Paired shipments | Paired endpoints with supported precedence and vehicle semantics |
| Heterogeneous fleet | Vehicle type count, capacity, fixed/variable costs, shifts, and limits |
| Time windows | Arrival, waiting, service, departure, release time, and shift visualization |
| Multiple depots | Start/end depot choices allowed by the pinned model |
| Reloads/multiple trips | Explicit reload depots, trip load resets, and trip visualization |
| Optional clients | Visit rewards, skipped clients, and transparent objective breakdown |
| Client groups | Supported group restrictions and alternative service options |
| Routing profiles | Profile-specific directed distance/duration matrices |
| Solver configuration | Seed, stopping criteria, statistics, and verified advanced parameters |

The primary workflow (§1) also needs these behaviors. Each is labeled native or preprocessing in the UI, the capabilities document, and the Python export:

| Behavior | How it is provided |
| --- | --- |
| Open routes (no return to the depot) | Native if the pinned release supports vehicles without a required return; otherwise zero-cost return-to-depot edges, labeled as a workaround. An M1 capability fixture proves whichever is used. |
| Maximum leg distance (500 mi default) | Preprocessing: legs longer than the limit are made unusable in the matrix given to PyVRP. An M1 fixture confirms how the pinned release treats prohibited edges (missing edge or prohibitive cost) and that solutions never use them. |
| Maximum cluster diameter (500 mi default) | Enforced by the clustering stage (§8a), not by PyVRP. The route validator re-checks it. |
| Geographic clustering | scikit-learn k-means before PyVRP (§8a); not a PyVRP feature. |

Verify exact cost fields, overtime fields, shipment APIs, groups, depot time behavior, warm starts, and search parameters against the pinned release. Do not simulate unsupported constraints while labeling them native.

Exclude automatic US/EU hours-of-service planning, general compatibility and arbitrary sequencing beyond native supported relationships, native fairness objectives, and native soft clustering inside the routing model. The k-means clustering stage in §8a is in scope: it is a separate preprocessing step whose clusters become independent PyVRP solves. Optional future OR-Tools routing adapters must be labeled separately and have their own feature matrix. Simple workload metrics and user-drawn selection regions are allowed; they do not imply native optimization constraints.

Expose an internal capabilities document with versions, supported input fields, search parameters, limits, and adapter versions. Advanced UI and Python export derive from this contract, rather than independently inventing settings.

## 4. Workbench information architecture

Use a desktop-first application shell with navigation for Scenarios, Workbench, Experiments, Learn, and Settings. A scenario workbench has a primary map, editable stop/order table, configuration inspector, and route/timeline results. Use resizable panels and preserve panel preferences. Avoid a marketing landing page as the main application.

Required workbench sections: Data, Inventory, Fleet, Constraints, Travel, Allocate, Cluster, Solve, Results. The primary workflow presents Allocate → Cluster → Solve as one run with a single "Run pipeline" action; the stages remain individually inspectable. Keep basic and advanced controls distinct through progressive disclosure. Contextual explanations include plain-language meaning, units, a small example, model field, and relevant documentation.

Selecting a stop in the map/table/timeline selects the same stable ID everywhere. Selecting a route highlights its visits and associated vehicle. Filters include route, customer/order status, depot, geocoding source, allocation state, and data-quality warnings. Route colors remain stable within a comparison, with labels and patterns for accessibility.

Below tablet widths, use tabs or drawers instead of compressing four panels. Mobile supports browsing scenarios and inspecting results; complex editing is optimized for desktop. Provide keyboard controls, accessible titles, visible focus, non-map equivalents for selections, and a reduced-motion mode.

### Map behavior

Use mapcn alone for map setup and components. Do not integrate maps.black, its web component, or its styles. Use mapcn's default basemap tiles for v1; there are no self-hosted tiles. Always show the tile attribution. Record the tile provider and its usage terms in `docs/basemap.md`, separate from the component's MIT license. The app is a private, low-traffic deployment within those terms, and no paid dependency is added. A custom MapLibre style URL is an advanced deployment setting for future flexibility, not a required alternate provider.

Add/edit/drag stops and depots, inspect popups, toggle route layers, fit to results, and select stops in a region. Use Turf for point-in-polygon selection and geographic calculations. Region selection is an editor action, not a road closure or solver constraint. GeoJSON layers should render bulk points/lines; reserve rich DOM markers for selected locations when needed.

Route layers clearly distinguish straight-line schematic connections from OSRM road geometry. Geometry comes from the same recorded provider/profile/data context where possible. An imported matrix can have no road geometry. Never suggest that a pretty road route proves the solver used those roads or current traffic.

## 5. Scenario model and persistence

Scenario identity and editable metadata are separate from versioned content. Saving creates a new immutable scenario version; optimistic concurrency prevents one user silently overwriting another. Autosave shows pending/saved/conflict states. On a version conflict, offer exactly two actions: **Save my edits as a new branch**, which creates a branch from the version the user started editing and applies their edits, or **Discard my edits and reload**. Never overwrite silently or merge automatically. Branching creates a new scenario referencing its parent version. Existing runs always reference the original version and settings snapshot.

Authorship: on first visit, the browser asks for a display name and stores it with a random browser identifier. The display name is recorded on saved versions, runs, and experiments. It is a label, not authentication.

Time model: each scenario has an IANA timezone (default taken from the browser) and a planning date, and it plans a single-day horizon. Time windows, shifts, and release times are entered as local clock times and stored as integer seconds from local midnight of the planning date. Late shifts may extend past midnight up to a scenario horizon end (default 24:00, maximum 48:00). The timeline and exports display local clock times; the solver receives the integer seconds. Multi-day horizons are out of scope for v1.

Canonical data model:

- Location: stable UUID, label, optional original address, latitude/longitude, coordinate provenance, time windows, service duration, release time, and customer/depot roles.
- Order: stable UUID, customer/location reference, order date/timestamp, priority, fulfillment policy (piece-level by default, or whole-order), required/optional status where applicable, and one or more order lines.
- Order line: stable UUID, product reference, ordered pieces (integer), net value per piece (integer cents), and linear feet per piece. The allocated amount is derived, never entered: allocated pieces × net value per piece.
- Product: stable UUID, label, discrete quantity unit (a piece), default linear feet per piece, optional mass/volume per unit, and display metadata. An order line may override the product's linear feet per piece.
- Inventory: available integer pieces by product and depot; explicit provenance and optional cost/value weights.
- Vehicle type: count (unlimited by default), capacities, supported native costs, start depot, open or closed route, shift limits, travel profile, maximum distance/duration, and native reload fields. The default is a 53 ft trailer with linear feet as its only capacity dimension, an open route, and a fixed cost per truck so fewer, fuller trucks are preferred.
- Shipment: pickup and delivery visits and their shared load, modeled independently from depot-stock customer orders.
- Client group: supported alternatives/restrictions with stable member IDs.
- Travel configuration: mode, circuity factor, maximum leg distance, coordinate order, profile, provider revision, scaling, distance and duration matrices.
- Clustering configuration: k (fixed or auto), k-means seed and `n_init`, and maximum cluster diameter (§8a).
- Solver configuration: seed, stopping criterion, time/iteration budget, advanced parameters, and initial solution if supported.

Units: linear feet are stored as integer hundredths of a foot, so a 53 ft trailer has capacity 5,300. Money is integer cents.

Do not conflate an order with a visit. In the primary workflow, allocated order lines at the same location are aggregated into one stop whose load is the sum of their allocated linear feet and whose value is the sum of their allocated amounts; the stop keeps the list of contributing lines for results and exports. A stop whose load exceeds one trailer is split into several visits of at most one trailer each, filling whole pieces greedily in the same order used by allocation; the split is recorded and shown. Other aggregations need documented handling of rewards, mandatory service, service time, and windows. Separate competing alternative visits/groups explicitly.

Suggested Drizzle tables: workspaces, scenarios, scenario_versions, experiments, runs, jobs, job_events, matrix_artifacts, route_geometry_artifacts, allocation_results, cluster_results, solution_artifacts, application_settings, and geocode_cache. A single shared workspace; persistent individual preferences use the browser identifier, not an accounts system.

Use UUID primary keys (stored as text), foreign keys, timestamps, schema versions, uniqueness constraints, and indexes for scenario versions, run status/date, and claimable jobs. Store editable/versioned scenario documents and small result summaries as JSON text columns, queried with SQLite JSON functions where needed. Store large matrices and detailed outputs as versioned compressed BLOB artifacts, keyed by content hash with size bounds, so the whole application state backs up as one file. Do not store each matrix cell as a relational row or send every matrix with scenario-list requests. No object-storage service is required; maintain a replaceable artifact-store interface so a filesystem store under the data directory can replace BLOBs later if the database grows too large.

Why not browser-only storage: scenarios and experiments are shared between users, the durable job queue must be claimable by the server-side worker and survive closed tabs, and the geocode and matrix caches are shared server state. Browser storage holds only presentation preferences.

The database is a single SQLite file under `DATA_DIR` (default `/data/fillrate.sqlite` in the container, `./data/dev.sqlite` in native development). Tests use temporary database files and never point at a deployment volume. Back up with `sqlite3 .backup` or `VACUUM INTO` to a timestamped file (never by copying the live file while WAL is active), and document the restore procedure. No hosted database, provisioning, or database credential is required.

## 6. Imports and geocoding

Support CSV, canonical JSON, and GeoJSON points. The first import path (M3) is CSV for order lines (order ID, order date, location with coordinates or address, product, ordered pieces, net value per piece, linear feet per piece) and inventory (product, available pieces). Provide column mapping, sample previews, downloadable templates, row-level validation, duplicate ID checks, and a non-destructive import preview. Preserve original input alongside normalized values. Reject nonfinite coordinates, invalid ranges, negative quantities, inconsistent units, malformed windows, and conflicting group references.

Census is the initial US address geocoder. Imports use the Census **batch** address endpoint (CSV upload, at most 10,000 rows per request, chunked by the geocoding job). Single manual entries use the one-line address endpoint. The benchmark is `Public_AR_Current`. Support coordinate-only inputs worldwide. Coordinates supplied by the user take precedence unless they explicitly request re-geocoding. Cache results using normalized address plus provider, benchmark, and relevant request options. Preserve match type, matched address, raw response reference, and timestamp.

Coordinate sources: imported coordinate, manually placed, Census match, ZIP/ZCTA approximate fallback. Census interpolation is not rooftop accuracy. ZIP/ZCTA approximation is a separate fallback adapter; do not claim the address geocoder returns a ZIP centroid automatically. The fallback dataset is the Census Gazetteer ZCTA file, which is public domain. A build script downloads a pinned vintage and converts it to a compact lookup bundled in the image. Each approximate coordinate records the provenance `zcta-gazetteer-<vintage>` and uses the ZCTA internal point. ZIP codes with no ZCTA, such as PO-box-only and unique ZIPs, remain unresolved. Document the ZIP-versus-ZCTA distinction in the import help. Never invent confidence scores.

Default: allow fallback with a visible review warning. Settings can disable it or exclude approximate stops. Missing coordinates remain unresolved; never silently use (0,0). Show fallback counts before solve. Allow map corrections with undo. Keep original and corrected coordinate provenance.

## 7. Travel matrices and OSRM

Supported modes:

1. Haversine distance multiplied by a circuity factor (default 1.2, the primary user's current "mileage cushion"), with an explicitly configured constant-speed duration estimate; the label always says estimated/schematic and shows the factor.
2. OSRM directed road-network distance and duration matrices.
3. Imported directed matrices with node order, units, profile, and metadata.

Default global mode is Haversine × circuity factor, which matches how the primary user measures miles today and needs no road server. The maximum leg distance and maximum cluster diameter (default 500 mi each) are measured in the same miles the solver uses, so with the default mode they apply to haversine × 1.2, as the primary user confirmed. Which miles the limits use is still a setting. OSRM remains optional and moves to a later milestone (§15); the single-state dataset cannot cover 500-mile loads in general. Require a configured endpoint before selecting it. Curated road lessons may ship recorded matrices and corresponding metadata. Public OSRM demo servers are not the batch infrastructure for 500-stop experiments.

Default internal units: meters, seconds, integer quantities, and integer cents for money. UI defaults: miles and minutes; support kilometers and alternative display units. Costs and rewards use this integer scaling policy. Fixed vehicle costs and visit rewards are cents. Distance cost is entered per mile or kilometer, and duration cost per hour. Both convert to cents per meter and cents per second at the solver boundary, as integers where the pinned PyVRP release requires integers, with a recorded scale factor where needed to avoid rounding cost rates to zero. Round/scale once at the solver boundary, preserving raw provider matrices and effective solver matrices. Validate safe ranges against the pinned solver constants.

OSRM Table requests may require both block partitioning and coordinate/request-size limits. Reassemble by stable source/destination IDs; preserve asymmetry and zeros on the diagonal. Choose a configurable default block size of 50 sources and 50 destinations, then adapt to endpoint capability and coordinate limits. Limit concurrency, support cancellation and retry transient failures, and report progress based on completed blocks.

OSRM profiles are determined by the prepared routing dataset. Changing a URL string from driving to cycling does not prepare a new dataset. Profile settings map to actual configured endpoints/datasets. Regional routing deployments use a pinned image, recorded OSM extract date, and documented coverage.

The v1 road provider is an optional self-hosted OSRM service in the same Compose project (profile `osrm`). It uses a pinned `osrm/osrm-backend` image, the car profile, and the MLD pipeline, and covers one US state chosen at deploy time and recorded in `docs/decisions.md`. `deploy/osrm/prepare.sh <geofabrik-region-path>` downloads the Geofabrik extract, runs `osrm-extract`, `osrm-partition`, and `osrm-customize`, and writes `extract-meta.json` with the source URL, extract date, and image tag. The app reads `OSRM_URL` (for example `http://osrm:5000`) and an optional `OSRM_PROFILE_LABEL`; the health view shows the dataset metadata. Stops outside the covered region surface as unreachable edges, never as silent fallbacks.

Unreachable edges remain unreachable. Default behavior blocks a solve when a required visit is unreachable; optional visits get a documented exclusion or supported graph representation. Any Haversine fallback is an explicit experiment setting and records affected edges. Do not silently combine road and straight-line costs.

Cache immutable matrix artifacts by ordered coordinates, provider/profile identity, dataset revision (from `extract-meta.json` for self-hosted OSRM), options, and conversion policy. Coordinate edits invalidate the relevant cache. Route geometry is cached separately and fetched only for inspected solutions. Matrix inspector displays a virtualized table/heatmap, unreachable edges, symmetry differences, and units.

## 8. Inventory allocation experiments

The first release includes multi-product data and **piece-level allocation**: an order line can be partly filled, in whole pieces, when stock is short. This is the primary user's model and the v1 default. Whole-order allocation (every line of an order filled in full, or none) remains a selectable fulfillment policy. Hide unavailable modes rather than providing inert controls.

Allocation strategies (each works in piece-level mode; whole-order mode applies the same ordering to whole orders):

- **Order date, then value (default):** sort open order lines by order date ascending, then net value per piece descending, then stable ID. Walk the list and allocate `min(remaining ordered pieces, remaining stock)` of the line's product. Deterministic.
- First-come: order date, then stable ID (no value tiebreak).
- Priority: descending priority, then order date, then stable ID.
- Proportional (fair-share greedy): for each depot and product, compute the fill ratio `r[d,p] = min(1, stock[d,p] / demand[d,p])` and give each customer a target of `r` times their demanded pieces. In piece-level mode, allocate floor(target) per line and distribute the remaining pieces one at a time to the customer with the lowest fulfilled-to-target fraction, breaking ties by order date, then value, then stable ID. In whole-order mode, repeatedly accept, among orders that still fit, the order whose customer is furthest below target, with the same tiebreaks. Label it a heuristic.
- Optimized: OR-Tools CP-SAT chooses integer allocated pieces per line (or whole orders) under per-product/per-depot stock constraints.

Default optimized objective: maximize total allocated amount (revenue, in cents). An optional "respect order date" constraint forbids shorting an older line of a product while a newer line of the same product receives pieces. A lexicographic priority objective (maximize weighted priority, then allocated amount) remains available: priority is a positive integer from 1 to 100 (default 1). Each stage has its own time limit (default 10 seconds) and reports its own CP-SAT status. If an earlier stage is not proven optimal, the next stage constrains its value to at least the best found and says so. Do not mix dollars, miles, and quantities without explicit normalization. Provide tradeoff summaries rather than a misleading single universal score.

For each line l and candidate depot d, use an integer variable `a[l,d]` in `[0, ordered[l]]` (a binary `x[i,d]` per order in whole-order mode, with every line of the order tied to it). At most one depot supplies an order in v1. For every product p and depot d, the sum of allocated pieces is at most `stock[d,p]`. If depot-specific dispatch cannot be represented by the selected PyVRP model, solve accepted orders in explicitly partitioned depot subproblems and report the partitioning limitation. No hidden cross-depot sourcing or stock borrowing. The primary workflow has one depot.

Minimum shipment quantities per line remain deferred (§17).

Default staged flow: allocate → aggregate allocated lines into stops → cluster (§8a) → mark allocated stops mandatory for that routing experiment → solve per cluster. If no feasible solution is found, preserve the allocation and report route infeasibility; do not count accepted stock as delivered. Users can branch allocation, fleet, or constraints and rerun. A later route-aware repair loop may return stock and choose different orders, but is not claimed as joint optimization.

Optional-client prize-collecting lessons are separate from stock-allocation selection. Model adapters enforce inventory bounds even if an experimental mode later makes allocated visits optional. Report ordered, allocated, loaded, delivered-in-simulation, and unshipped pieces separately, by product, each with its amount in cents. Depot reloads cannot create stock. Default stock experiment adapter rejects unsupported reload/sourcing combinations with a clear explanation rather than making an invalid model.

Do not count modeled pickup quantities as newly available depot inventory unless an explicitly supported inventory transfer model is implemented. Each strategy's output includes allocation decisions, residual stock, objective components, status, runtime, and heuristic/solver provenance. CP-SAT status must distinguish feasible from proven optimal and infeasible from unknown.

## 8a. Clustering and iteration pipeline

A pipeline run executes these stages against immutable snapshots, and each stage's output is stored and inspectable:

1. **Allocate** (§8).
2. **Aggregate** allocated lines into stops, and split any stop larger than one trailer (§5).
3. **Cluster** stops with scikit-learn k-means. Features are latitude/longitude converted to 3D unit vectors, not raw degrees, so distances are not distorted by longitude convergence. Record k, the seed (default 0), `n_init`, and the scikit-learn version.
4. **Enforce the diameter.** For each cluster, compute the widest pair distance in solver miles. A cluster over the maximum diameter (default 500 mi) is re-split with 2-means (bisecting) until every cluster passes. Record every split. A single stop never violates the diameter; a stop that cannot be reached from the depot within the leg limit is reported, not silently dropped.
5. **Solve** each cluster as an independent PyVRP problem: the depot, the cluster's stops as mandatory clients with linear-feet demand, an unlimited (or configured) fleet of 53 ft trailers with a fixed cost per truck, open routes, and legs over the maximum leg distance prohibited (§3). A cluster may use several trucks.
6. **Validate** every truck independently: load ≤ capacity, no leg over the limit, every stop in its cluster, and the cluster diameter.
7. **Compute metrics** and unshipped reasons (§10).

**Choosing k:** either a fixed k, or **auto** (default): the smallest k for which every k-means cluster passes the diameter check before any bisecting repair, searched upward from 1 with a bounded maximum. The chosen k and the search are recorded.

**Cluster stability.** The primary user chooses k by trial and error today, rerunning k-means to reduce run-to-run variance until stop groupings are trustworthy. The workbench supports this directly with a **k explorer**, which runs clustering only (no allocation changes, no PyVRP) for a range of k and a list of seeds (default 0–9), and shows:

- **Per k:** within-cluster variance (k-means inertia) as an elbow chart, the number of clusters that need diameter repair, and **stability**: the mean adjusted Rand index between every pair of seeds' assignments. Higher means the grouping doesn't depend on the seed.
- **Per stop, at the selected k:** **assignment confidence**. Build the co-assignment matrix (for each pair of stops, the share of seeds that put them in the same cluster). A stop's confidence is its mean co-assignment with the other stops in its cluster in the reference assignment (the chosen seed, default 0). Co-assignment ignores cluster labels, so label order across seeds doesn't matter. The map colors stops by confidence, so unstable border stops stand out.

The user picks k (and optionally a seed) from the explorer, and that choice feeds pipeline runs and sweeps. Inertia, stability, and confidence are descriptive statistics, labeled as such; they are not solver objectives. The explorer's clustering-only runs are durable jobs like any other and count toward `MAX_SWEEP_RUNS`.

**Iterations are experiments.** A sweep varies any of: k (a range), k-means seed, PyVRP seed, inventory percentage, allocation strategy, fulfillment policy, circuity factor, and the distance limits. The default maximum sweep is 25 runs (`MAX_SWEEP_RUNS`).

**Metrics** are shown side by side; there is no hidden composite score:

- Truck fill: fill % per truck (loaded linear feet / capacity), average and minimum fill, and trucks used.
- Cluster tightness: widest pair distance, mean distance to the cluster centroid, loaded miles (depot to last stop, open route), and, when the run's k came from the k explorer, that k's stability score.
- Revenue: allocated amount shipped, compared with allocated and ordered amounts.

The comparison view highlights runs that no other run beats on all three metric groups (the non-dominated set). A user may define explicit metric weights for a ranking, which is stored with the experiment and labeled as user-defined.

## 9. Solve execution and durable jobs

Create a run from immutable scenario, allocation, matrix, and effective settings snapshots. Public POST operations support idempotency keys. Each run has one or more durable jobs, dependencies, input hashes, and attempts.

States: queued → claimed → running → succeeded, failed, cancelled, or interrupted. Keep cancellation request separate from final status. A claim has a lease token, worker identity, expiry, and heartbeat; completion accepts only the current lease and attempt. Transactional claims prevent duplicate workers. A crash expires the lease; bounded retry records the prior attempt and reason. Permanent validation failures are not retried.

A pipeline run (§8a) fans out into allocate, cluster, one solve job per cluster, and an aggregate job, linked by dependencies. A failed cluster solve fails the run with that cluster identified; completed cluster results are kept.

Default worker concurrency: one solve process, with a bounded queue. Default solver search budget: 10 seconds per cluster in pipeline runs and 30 seconds for single-problem lessons; expose 5/10/30/120-second presets and an advanced budget. Deployment hard limits: 300 seconds per solve attempt and 600 seconds per pipeline run (`RUN_WALL_LIMIT_SECONDS`), distinct from solver search time. Default lease 60 seconds, heartbeat 10 seconds; configurable in deployment. Allow small bounded concurrency for geocoding/matrix I/O separately from solver CPU.

Cancellation kills the solver child process when cooperative interruption is unavailable, releases resources, and persists the cancellation. No solver call may block FastAPI's event loop or a Next.js request. Page refreshes and web restarts retain queued/completed runs. Worker reconnects must not overwrite a newer attempt.

Poll run summaries initially; refresh active jobs around every two seconds, with backoff and pause when appropriate. Use coarse persisted progress events, not per-iteration database writes. Read final solver statistics for convergence charts. Do not invent live route snapshots or search telemetry that the pinned API cannot provide.

Random seed is recorded. Iteration-based stopping is preferred for reproducibility lessons; time-based stopping is convenient but does not guarantee identical results on different machines. Capture versions, platform, budgets, scaling, matrices, and warnings.

## 10. Results, evaluation, and comparison

Pipeline results exist to replace manual interpretation. For every pipeline run, show:

- **Cluster cards:** stops, trucks, loaded linear feet, average and minimum fill %, widest pair distance, and revenue, per cluster.
- **Truck loads:** per truck, the stop sequence and the order lines on board (pieces, linear feet, amount), with fill % and loaded miles.
- **Map:** stops colored by cluster, cluster hulls, and truck paths (straight-line, labeled schematic).
- **Unshipped lines, each with a reason:** not allocated (no stock, with the competing earlier or higher-value lines that took it), allocated but not loaded (did not fit, or unreachable within the leg limit), or excluded by a data-quality problem.
- **Run summary:** the three metric groups from §8a and the run's settings.

For single-problem runs and lessons, show best solution found, feasibility status, objective breakdown, routes/vehicles used, total distance, duration, travel/wait/service time, visit counts, capacity utilization, allocation/fulfillment by product, and workload distribution metrics. Distinguish nominal cost from infeasibility penalties and missing optional rewards according to PyVRP semantics. Do not call the solution optimal without proof.

Route inspection shows ordered visits, depots/reloads, arrival/service/departure, window slack where supported, and load before/after service. A playback cursor interpolates along road geometry using planned travel duration; it is a simulation without live traffic or GPS. Drive, wait, and service states appear on both map and timeline.

Manual baseline editing supports visit reorder and vehicle assignment. Evaluate with the same matrices and constraint semantics before comparing. Invalid manual solutions show concrete violations; saving a manual baseline does not imply solver feasibility. Warm starts are enabled only when supported and validated.

Preflight diagnostics identify provable issues: demand exceeding capacity, invalid windows, missing nodes, zero available vehicles, inconsistent shipment/group definitions, and unreachable required edges. A solver timeout without a feasible solution does not prove mathematical infeasibility. Diagnostics about skipped optional stops are observed tradeoffs, not invented explanations of solver intent.

Experiments compare multiple seeds and budgets against the same scenario/matrix snapshot. Default seed list: 0, 1, 2, 3, 4; a single run defaults to 0. Show best/median/range, feasible-run count, wall time, and fulfillment. Sweeps support the pipeline parameters in §8a plus vehicle count, selected capacity, optional reward, and runtime. Default maximum sweep: 25 runs; configurable hard limits. The iteration comparison table lists one row per run with truck fill, tightness, revenue, trucks, k, and the varied settings, and marks the non-dominated runs.

Comparison views include synchronized maps, configuration diffs, convergence charts, and tabular metrics. Comparisons with different matrices, objectives, allocations, or versions display those differences; raw solver scores from incompatible objectives are not ranked as equivalent. Distance and fulfilled order count remain interpretable cross-run metrics with context.

## 11. Settings and override semantics

Provide a real Settings surface with General, Maps & Travel, Imports & Geocoding, Solver Defaults, Allocation Defaults, Experiments, and Administration. Add search, descriptions, units, reset-to-default, validation, and source indicators.

Resolution order: built-in default → workspace setting → scenario override → explicit run override. Deployment hard limits always bound the resolved result. Browser preferences apply only to presentation. Persist the resolved settings and their schema version on every run; editing a global default never mutates prior results.

| Setting | Initial default | Scope |
| --- | --- | --- |
| Theme | System | Browser preference |
| Distance display | Miles | Browser/workspace |
| Time display | Minutes; detailed timestamps in timeline | Browser/workspace |
| Panel layout | Map + inspector + bottom table/results | Browser |
| Travel mode | Haversine × circuity factor, estimated | Workspace/scenario/run |
| Circuity factor | 1.2 | Workspace/scenario/run |
| Maximum leg distance | 500 mi (solver miles) | Workspace/scenario/run |
| Maximum cluster diameter | 500 mi (solver miles) | Workspace/scenario/run |
| Trailer | 53 ft, linear feet only, open route, unlimited count | Workspace/scenario/run |
| Estimated speed | 25 mph, clearly labeled | Workspace/scenario/run |
| OSRM endpoint/profile | From `OSRM_URL`; unconfigured if unset | Deployment (env) |
| Basemap | mapcn default | Workspace |
| Custom MapLibre style URL | Optional, empty; must match `MAP_STYLE_ALLOWLIST` | Workspace |
| Geocoder | Census for US addresses | Workspace/scenario |
| ZIP fallback | Enabled with review warning | Workspace/scenario |
| Approximate-coordinate inclusion | Include with warnings | Scenario/run |
| Solver seed | 0 | Workspace/scenario/run |
| Search time | 10 seconds per cluster (pipeline); 30 seconds (single problem) | Workspace/scenario/run |
| Solver objective | Native travel cost plus fixed cost per truck; declare fixed/variable costs | Scenario/run |
| Allocation strategy | Order date, then value; optimized comparison available | Workspace/scenario/run |
| Order fulfillment | Piece-level; whole-order selectable | Scenario/run |
| Optimized allocation objective | Maximize allocated amount | Scenario/run |
| Cluster count (k) | Auto (smallest k passing the diameter check); or chosen in the k explorer | Scenario/run |
| k explorer seeds | 0–9 | Workspace/scenario |
| k-means seed | 0 | Workspace/scenario/run |
| Comparison seeds | 0–4 | Workspace/experiment |
| Order limit | 5,000 orders per scenario | Deployment hard limit (env `MAX_ORDERS`) |
| Stop limit | 500 stops per cluster solve | Deployment hard limit (env `MAX_STOPS`) |
| Maximum sweep | 25 runs | Deployment hard limit (env) |
| Worker concurrency | 1 solve | Deployment |
| Wall-clock hard limits | 300 seconds per solve attempt; 600 seconds per pipeline run | Deployment |
| Artifact retention | Keep saved runs; explicit cleanup | Workspace (Administration) |

There are no roles: everyone who can reach the app is trusted (see §14), and the Administration section is simply where rarely-changed workspace settings and cleanup actions live. Deployment hard limits and provider endpoints come only from environment variables and are shown read-only in Administration. Keep any configuration value out of settings JSON and out of browser forms that echo it. The server never fetches a URL a user typed unless it matches the env-configured `OSRM_URL` or `MAP_STYLE_ALLOWLIST`, so the app cannot become an open URL fetcher. Do not expose worker concurrency and lease internals in ordinary lesson controls.

## 12. Public and internal API contract

Version public endpoints under /api/v1. Resource responses use stable IDs and schema versions; errors include machine code, human explanation, and field paths.

| Endpoint family | Purpose |
| --- | --- |
| scenarios and versions | List/create/branch/save with expected version |
| imports/preview and imports/commit | Validate/mapping preview, then explicit scenario changes |
| geocoding jobs | Resolve coordinates without blocking requests |
| matrices | Create, inspect metadata/blocks, and reference immutable artifacts |
| allocations | Create strategy comparison tasks and inspect residual stock |
| runs | Create pipeline or single-problem runs, read status/results (including per-cluster results, truck loads, and unshipped reasons), request cancellation |
| experiments | Create bounded sweeps and aggregate results, including per-run pipeline metrics |
| evaluate | Validate/evaluate a manual route with identical model semantics |
| exports | JSON, CSV, GeoJSON, and reproducible Python bundle |
| settings | Read/update defaults with expected revision |
| capabilities | Supported solver/adapter/schema versions |

Internal worker routes: claim, heartbeat, progress, artifact submission, completion/failure, and cancel status. Serve them under `/internal/`, reject requests that did not originate from loopback, and require the worker token, job lease token, attempt number, and idempotent event sequence. Artifact writes are staged until an atomic final manifest is committed. Reject stale completion, duplicate mutations, and oversized payloads. Use batching/chunking for artifacts without partial-result corruption.

FastAPI exposes /health, /capabilities, /validate, and /evaluate on localhost inside the container. Public requests reach these through Next.js. Validate shared schemas with round-trip contract fixtures and generated TypeScript types; do not maintain two unrelated definitions.

## 13. Learning and exports

The flagship lesson is **Fulfillment pipeline**: a synthetic single-depot scenario with about 2,000 open orders across several products, scarce inventory, and US-scale coordinates, walking through allocation, clustering, per-cluster loads, and an iteration sweep. It uses synthetic data only (§14).

Also bundle tested lessons: basic capacity; multiple load dimensions; time windows and waiting; heterogeneous fleets; multiple depots; reloads; optional visits/rewards; alternative service groups; paired shipments; Haversine versus recorded road matrices; scarce single-product inventory; piece-level versus whole-order allocation; manual versus optimized routes; and seed/runtime sensitivity.

Every lesson has a short explanation, editable starter scenario, expected observations rather than fixed heuristic routes, documented supported model fields, and a reset action. Include abstract planar instances as well as geographic examples. Abstract benchmark coordinates are not automatically treated as latitude/longitude.

Exports:

- Canonical versioned scenario JSON, settings snapshot, allocation decisions, matrices, results, and provenance.
- CSV stop/order/route summaries with units and stable IDs.
- GeoJSON points and route geometry where available.
- CSV truck-load and cluster summaries, and unshipped lines with reasons.
- Python reproduction bundle with the full pipeline (allocation, stop aggregation, k-means and diameter repair, per-cluster model builder), supplied matrix data, allocation inputs/results, requirements or lock information, and README command.

Python exports run without web application credentials and reproduce the experiment pipeline. Include secrets-free provider metadata and cached matrices rather than requiring live geocoding/routing calls. Explain time-budget variability and support an iteration-based reproduction mode. VRPLIB import/export is a later feature until the supported rich-variant subset is validated; JSON is the canonical lossless format.

## 14. Deployment, access, and operations

Default deployment is private Docker Compose running the single `ghcr.io/timblazing/fillrate` image with a mounted data volume, plus an optional OSRM service. No public signup or accounts workflow. Initial native development uses Bun for web and uv for Python dependency environments. Provide .env.example; every variable is optional.

Environment variables, all optional:

- `DATA_DIR` (default `/data`).
- `WORKER_TOKEN`, generated randomly at startup when unset, since both processes share the container.
- `OSRM_URL` and `OSRM_PROFILE_LABEL`.
- `MAP_STYLE_ALLOWLIST`.
- Hard limits: `MAX_ORDERS`, `MAX_STOPS` (per cluster solve), `MAX_SWEEP_RUNS`, `SOLVE_WALL_LIMIT_SECONDS`, `RUN_WALL_LIMIT_SECONDS`, `SOLVE_CONCURRENCY`.
- `PORT` (default 3000).

The application needs no third-party secrets; the Census geocoder requires no key. Never put server-only values in NEXT_PUBLIC variables.

### Container image and CI

Publish one image, `ghcr.io/timblazing/fillrate`, containing both the web app and the optimizer:

- Multi-stage Dockerfile at the repository root. One stage installs dependencies with Bun and builds the Next.js standalone output (`output: "standalone"`), compiling `better-sqlite3` for the target platform. Another creates a Python 3.13 virtual environment with uv from the locked, pinned PyVRP, OR-Tools, scikit-learn, and FastAPI dependencies. A third fetches the pinned ZCTA Gazetteer lookup. The runtime stage is based on `node:24-slim` plus a matching Python 3.13 runtime and copies all three. Bun is not needed at runtime.
- The runtime starts the Next.js server and the FastAPI service/worker supervisor under a small init such as `tini` with a supervisor script. Run migrations before either server accepts work. If either process exits unexpectedly, the container exits so the restart policy recovers it.
- Run as a non-root user, expose only the web port (3000), declare `/data` as a volume, and add a `HEALTHCHECK` against the web health route. That route also reports worker connection and database status.
- The Python service listens only on localhost inside the container.

GitHub Actions workflow `.github/workflows/ci.yml` runs on pull requests and on pushes to `main`:

- `bun install --frozen-lockfile`, lint, typecheck, and Vitest (including the real-file SQLite claim-race test).
- `uv sync --locked` and pytest (capability fixtures, allocation, and validation).
- Contract round-trip fixtures, and a Playwright smoke run against a production build.

GitHub Actions workflow `.github/workflows/image.yml`:

- Triggers: successful completion of `ci.yml` on `main` (through `workflow_run`), tags matching `v*`, and `workflow_dispatch`. Pull requests build the image without pushing.
- Uses `docker/setup-qemu-action`, `docker/setup-buildx-action`, `docker/login-action` with `GITHUB_TOKEN` (permissions `contents: read`, `packages: write`), `docker/metadata-action`, and `docker/build-push-action` with GitHub Actions layer cache.
- Tags: `latest` for the default branch, `sha-<short>`, and semver tags (`1.2.3`, `1.2`) for `v*` tags. Add OCI labels for source, revision, and version.
- Platforms: `linux/amd64` and `linux/arm64`. Verify that pinned PyVRP and OR-Tools wheels exist for both; drop arm64 rather than compile from source if they do not.
- A smoke job runs the built image with a temporary volume, waits for health, and completes one bundled lesson solve through the public API before the image is pushed as `latest`. Once M3 lands, the smoke solve is a small pipeline run.

Reference `deploy/compose.yaml`:

```yaml
services:
  fillrate:
    image: ghcr.io/timblazing/fillrate:latest
    restart: unless-stopped
    ports: ["${BIND_ADDR:-127.0.0.1}:3000:3000"]   # set BIND_ADDR to the host's Tailscale IP
    volumes: ["./data:/data"]
    env_file: [{ path: .env, required: false }]
  osrm:                                  # enabled with `docker compose --profile osrm up -d`
    image: osrm/osrm-backend:<pinned tag>
    profiles: ["osrm"]
    restart: unless-stopped
    command: osrm-routed --algorithm mld --max-table-size 10000 /data/region.osrm
    volumes: ["./osrm:/data"]            # produced by deploy/osrm/prepare.sh
```

When the `osrm` profile is used, set `OSRM_URL=http://osrm:5000` in `.env`. The OSRM service publishes no host port.

The repository and GHCR image are public, so servers pull without a registry login. Real delivery data, customer addresses, and derived matrices never go into the repository, test fixtures, lesson data, or the image. Lessons use synthetic or public data. Real data exists only in the deployment's `/data` volume and in user-initiated exports.

Access control belongs to the deployment; the app has no authentication. The reference deployment is a locked-down host reachable only over Tailscale. A separate Caddy VPS terminates HTTPS for `fillrate.blasingame.dev` (a subdomain of the owner's existing domain; no new domain is purchased) and reverse-proxies to the host's Tailscale IP and port, and the host firewall allows nothing else. Everyone who can reach the app is trusted. Native development binds to localhost. Next.js must honor `X-Forwarded-*` headers from the proxy only for URL generation; access decisions never depend on them.

Log job/run IDs, attempts, durations, and error codes. Redact tokens and avoid logging full customer addresses. Health/status views report queue length, worker connection, solver versions, database availability, and road provider configuration. Explicit cleanup can remove old artifacts while preserving referenced saved runs. Migration procedure, backups, and restart recovery are documented.

## 15. Implementation sequence

1. Foundation and capability proof: monorepo, pinned dependencies, Drizzle schema/migrations, SQLite setup (WAL, pragmas, migrate-on-start), API contracts, worker claim/lease flow, minimal real PyVRP solve, capability fixtures (including open routes and prohibited edges, §3), first export, `AGENTS.md`/`CLAUDE.md`/`docs/decisions.md`/`docs/progress.md`, and the Dockerfile plus CI and GHCR workflows so every later milestone is tested and deployable.
2. Design: create complete workbench and results concepts centered on the pipeline screens (orders and inventory, run pipeline, cluster cards, truck loads, unshipped reasons, iteration comparison), rendered as real HTML/React screens with coss ui and mapcn rather than generated images. The user reviews and accepts them before detailed styling, and the accepted direction is recorded in `docs/decisions.md`. Establish tokens and coss ui/mapcn composition. Never replace exact charts/maps with generated imagery.
3. Core pipeline: CSV import of order lines and inventory with coordinates, editable scenarios, Haversine × circuity matrices, piece-level "order date, then value" allocation, stop aggregation and splitting, k-means with diameter repair, per-cluster PyVRP solves as durable jobs, validation, cluster cards, truck loads, map, settings and snapshot semantics.
4. Iterations: the k explorer (inertia, seed stability, per-stop assignment confidence), bounded sweeps over the §8a parameters, the iteration comparison table and non-dominated highlighting, unshipped-line reasons, and the Fulfillment pipeline lesson on synthetic data.
5. Allocation depth and imports: the other allocation strategies, CP-SAT with its objectives, whole-order mode, residual stock reporting, Census + ZIP geocoding, JSON/GeoJSON imports, and data review.
6. Remaining supported PyVRP features and roads: time windows, heterogeneous fleets, multiple depots, groups, shipments, reloads, profiles, native advanced options, OSRM block matrices/cache/geometry, imported matrices, manual evaluator, and supported warm starts.
7. Learning and exports: the remaining lessons, route timeline and playback, diagnostics, and the complete Python bundle export.
8. Verification and handoff: browser visual/interaction review, meaningful solver/inventory/clustering/contracts tests, 2,000-order target checks, recovery/cancellation tests, GHCR image and Compose deployment, backup/restore procedure, and native instructions.

Each milestone must be executable and persist real data. Do not deliver a polished mock with random routes, fake metrics, placeholder settings, or buttons that only show a toast.

## 16. Acceptance criteria and test plan

### Model correctness

- Native capability fixtures cover every exposed PyVRP feature against the pinned release.
- Independent route validation checks visit coverage, capacities/load transitions, supported windows, depot/reload semantics, shipments, and groups; tests use small constructed instances with known feasible/infeasible cases.
- Allocation, piece-level or whole-order, never exceeds stock for any product/depot. Residual inventory reconciles, and allocated amounts equal allocated pieces × net value per piece. Whole-order mode never partly fills an order.
- The "order date, then value" strategy is deterministic and never gives stock to a newer line while an older line of the same product is short, except through the value tiebreak on the same date.
- Every truck's load is at most its capacity (5,300 hundredths of a foot by default); no leg exceeds the maximum leg distance; every cluster's diameter is within the limit; each stop belongs to exactly one cluster and one truck.
- Oversize stops are split into visits of at most one trailer, and the split visits sum to the original stop.
- k-means results are identical for the same inputs, seed, and pinned versions; auto-k and diameter repair are deterministic.
- Stability and assignment confidence are invariant to cluster label permutation, equal 1 when every seed produces the same grouping, and are checked against hand-computed small cases.
- Mandatory allocated stops are not silently dropped; routing failures do not report successful fulfillment.
- Optional-client, reload, pickup, and inventory interactions are either validated or explicitly rejected by the selected adapter.
- Heuristic results, CP-SAT status, and PyVRP search outcomes are labeled correctly.

### Data and comparisons

- Coordinate provenance and ZIP approximation remain visible after import, correction, save, export, and solve.
- Directed matrices preserve order, asymmetry, units, unreachable edges, and block boundaries; no silent fallback occurs.
- Scaling fixtures reproduce solver costs without overflow; comparison metrics identify incompatible objective/matrix versions.
- Saved runs preserve scenario/settings/matrix snapshots after defaults or scenarios change.
- Python export reproduces a small iteration-budget run with the pinned environment; cost/feasibility is checked, not an arbitrary route ordering when ties exist.

### Job integrity

- A web refresh does not lose an active run.
- Concurrent claims cannot own the same valid lease; stale worker completion is rejected. Tests exercise parallel claim/heartbeat/complete calls against a real SQLite file in WAL mode without `SQLITE_BUSY` failures surfacing to users.
- Process termination, lease expiry, duplicate callback, and retry scenarios do not duplicate results or corrupt artifacts.
- Cancellation stops solver CPU work and produces a persisted terminal state.
- Large matrix/result transfers honor limits and finalize atomically.

### Interface and performance

- Map, table, timeline, filters, and route selection stay synchronized.
- Settings persist, resolve correctly, show units/default sources, and affect only new runs.
- Mapcn style/theme changes preserve scenario and route layers.
- Imports have previews and actionable row errors; invalid manual routes show violations.
- At the 2,000-order target, table/map interactions remain usable, matrix data is not repeatedly downloaded, and one solver does not stall application endpoints. A pipeline run at that size completes within the run wall-clock limit on the deployment machine. Record hardware and measured timings per stage.
- Learning mode works with bundled data without Census/OSRM connectivity. A writable data volume is required for persisted app state.
- Browser tests cover real scenario creation, save, solve, cancellation, branch, comparison, and export. Visual QA checks desktop and narrow layouts against the accepted design.
- Server-only modules (database, provider adapters, env config) are never bundled for the client. Internal worker endpoints reject non-loopback requests and requests without a valid worker token and lease.
- Time windows round-trip correctly across the scenario timezone, including a daylight-saving transition date and a shift that ends after midnight.

## 17. Deferred extensions

Minimum shipment quantities and per-product utility for partial fulfillment; route-aware allocation repair (returning stock from unloadable lines to other lines); joint allocation-and-routing optimization; optional OR-Tools routing comparisons; H3 clustering experiments; deck.gl visual layers; MapLibre-Geoman Free drawing tools; validated VRPLIB rich-variant import; public access/accounts; live traffic; real dispatch integration.

These are extension points, not required dependencies or nonfunctional UI promises. The first release should deliver a correct, explainable fulfillment pipeline (piece-level allocation, clustering, per-cluster loads, iteration comparison) and then deeply cover the pinned open-source PyVRP capabilities.

## 18. Implementation brief (Codex and Claude Code)

Implement this specification as a real full-stack application. Preserve Next.js + Bun tooling + Node runtime + coss ui (Base UI) + Tailwind + mapcn, OSRM + Turf, SQLite + Drizzle, and Python FastAPI + PyVRP + OR-Tools + scikit-learn. Do not add maps.black or paid enterprise features. Use whatever frontend, coss ui/Base UI, and React/Next.js guidance the current agent has available for UI concepting, component composition, and server/client boundaries.

The build alternates between Codex and Claude Code sessions. To keep context across sessions:

- `AGENTS.md` at the repository root is the canonical agent instruction file. It holds the repository layout, commands, conventions, and a pointer to this spec. `CLAUDE.md` contains only `@AGENTS.md`, so both tools read the same instructions.
- `docs/decisions.md` is an append-only decision log. Each entry records the date, the decision, the reason, and the session tool. It covers exact version pins, the OSRM state, the accepted design direction, and every deviation from or interpretation of this spec.
- `docs/progress.md` holds the milestone checklist from §15, the current state, known gaps or failing tests, and the single next step.
- Every session starts by reading `AGENTS.md`, `docs/progress.md`, `docs/decisions.md`, and the relevant spec sections. Before ending, it updates `docs/progress.md` and `docs/decisions.md` and leaves the tree in a state that passes CI, or records exactly what fails.
- Work happens on short-lived branches with pull requests into `main`. Commit messages reference the milestone.
- This spec changes only through a new revision note and version bump; implementation-level choices go in `docs/decisions.md`.

Begin with dependency/version checks, executable capability fixtures, and the minimal durable real-solve pipeline, then build toward the §8a fulfillment pipeline. Do not publish remotely or modify deployment data implicitly. Supply meaningful verification results, known adapter limits, and a reproducible run/export at each milestone handoff.

## 19. Primary references and verification notes

- [PyVRP repository](https://github.com/PyVRP/PyVRP) and [stable documentation](https://pyvrp.readthedocs.io/en/stable/): supported open-source and enterprise boundaries. Stable docs identified 0.14.0 during discovery; verify/pin at build time.
- [PyVRP v0.14.0 modeling code](https://github.com/PyVRP/PyVRP/blob/v0.14.0/pyvrp/Model.py): modeling adapter baseline.
- [coss ui docs](https://coss.com/ui/docs) and [llms.txt](https://coss.com/ui/llms.txt): UI primitives (Base UI) and their composition patterns.
- [mapcn repository](https://github.com/AnmolSaini16/mapcn) and [basic map docs](https://www.mapcn.dev/docs/basic-map): component setup, theme, routes, and separate basemap terms.
- [OSRM repository](https://github.com/Project-OSRM/osrm-backend) and [API documentation](https://project-osrm.org/docs/v5.24.0/api/): Table/Route requests, statically prepared profiles, limits, and data provenance. Match documentation to the pinned server version.
- [Turf.js](https://github.com/Turfjs/turf): browser geographic operations.
- [OR-Tools](https://github.com/google/or-tools): allocation/constraint programming and optional future routing models.
- [scikit-learn KMeans](https://scikit-learn.org/stable/modules/generated/sklearn.cluster.KMeans.html): clustering stage; record the pinned version with each run.
- [Bun Next.js guide](https://bun.sh/guides/ecosystem/nextjs): Bun as package manager/script runner for Next.js (the server itself runs on Node).
- [Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output): container build.
- [Drizzle SQLite guide](https://orm.drizzle.team/docs/get-started-sqlite) and [better-sqlite3](https://github.com/WiseLibs/better-sqlite3): database driver.
- [Census Geocoder API](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html) and [Census Gazetteer files](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html): address geocoding and ZCTA fallback.
- [Geofabrik downloads](https://download.geofabrik.de/north-america/us.html): state OSM extracts for OSRM. [SQLite WAL documentation](https://www.sqlite.org/wal.html): concurrency, checkpointing, and backup behavior.
- [Docker build-push-action](https://github.com/docker/build-push-action) and [GitHub Container Registry docs](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry): image publishing workflow.

Defaults, architecture, limits, settings, and implementation stages in this document are project design decisions, not claims that PyVRP or its companion libraries provide all these workflows out of the box.
