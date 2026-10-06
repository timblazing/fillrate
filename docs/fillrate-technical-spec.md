# Fillrate — Technical Specification

Version: 1.13 · Revised October 6, 2026

This is the canonical product and engineering contract. [Completion plan](completion-plan.md) defines the remaining delivery order and launch gates; [frontend specification](frontend-spec.md) defines dashboard integration and performance acceptance; [owner actions](owner-actions.md) separates deployment/input tasks from implementation. [Progress](progress.md) records evidence. Historical revisions are retained in [history](history/spec-revisions-through-1.12.md).

Current baseline: M1–M5 and M7 are complete for their accepted scopes. M6 routing implementations are merged, including Valhalla snapshot jobs, time windows, heterogeneous pipeline fleets, manual baselines/warm starts and Solver Lab adapters. Pinned Valhalla has local evidence; VPS coverage and timings remain unverified. M8 has broader browser coverage and native distribution documentation; the current image release is owned by another session. Existing hosted/request access and the owner sign-in have release evidence. A newly published image is not evidence of deployment. Dashboard composition and performance require the explicit completion pass below; accepted M2 review does not close it.

Reading guide: §1 defines the product and terminology; §2–3 define architecture and capability boundaries; §5–8a define the model and pipeline; §9–12 define execution and results; §15–16 define delivery gates and verification. Keep these section numbers stable for code and decision-log references.

## 1. Product definition

Fillrate is a publicly developed web tool for planning and comparing order-fulfillment shipments: allocate scarce inventory to open orders, group the stops, and build full truckloads, using real optimization runs. Open-source PyVRP builds the loads; OR-Tools and scikit-learn handle allocation and clustering. The initial users are Clay and a friend who already uses PyVRP and Census address geocoding with ZIP fallback. Support synthetic examples and real order data. Inventory scarcity is a first-class experiment area.

### Primary workflow (the friend's use case)

One depot ships open orders on 53 ft trailers. Each run:

1. **Allocate** available inventory to open order lines, piece by piece: order date first, then value (§8).
2. **Cluster** the allocated stops geographically with k-means on latitude/longitude (§8a).
3. **Build loads** inside each cluster with PyVRP. Linear feet are the only load limit, a cluster can need several trucks, routes are open (the truck does not return to the depot), and each consecutive leg must satisfy the 500-mile limit (§3, §7). Cluster diameter is an optional policy, off by default.
4. **Iterate** over combinations of stops, orders, and inventory, and compare runs on **truck fill**, **cluster tightness**, and **revenue** (allocated amount).

The friend's current pain is manually interpreting the output. Results must explain themselves: per-cluster and per-truck summaries, why each line did not ship, and side-by-side iteration comparison (§10).

Scenario workflow: create/import orders, inventory, and locations → inspect data quality → configure trailers and limits → allocate → cluster → build loads → inspect map, cluster cards, loads, and metrics → branch assumptions and compare iterations → export reproducible Python and data.

The fulfillment pipeline remains the primary product. Advanced adapters belong only where executable capability proofs and independent validation exist (§3); implemented Solver Lab features do not imply support in the business pipeline. The first useful release through M4 is already accepted. Completion of the current release follows the explicit gates in [completion-plan.md](completion-plan.md).

### What a successful first release answers

- What can ship with this inventory, and which demand remains unfilled?
- How many trucks does the chosen grouping require, how full are they, and which lines are on each truck?
- Which settings changed the outcome, and is the apparent improvement comparable and independently validated?

Allocation is an experiment against an inventory snapshot, not a warehouse reservation or stock decrement. A valid plan represents planned shipment, not evidence of delivery. Linear feet are a one-dimensional capacity model: no claim of physical packing, stackability, axle-weight, securement, or hours-of-service compliance.

### Terminology and responsibility boundaries

| Concept | Meaning and owner |
| --- | --- |
| Order / line | Business demand for integer pieces; Fillrate allocation |
| Location | Physical place with coordinates and provenance; matrix node identity |
| Stop / visit | Service obligation at a location; a location can have several visits |
| Activity | Adapter action, such as client service or depot departure; maps back to a visit |
| Allocation | Pieces selected from an inventory snapshot; greedy policy or CP-SAT |
| Cluster | Geographic partition that restricts which visits may share a truck |
| Load / route | Pieces assigned to one truck and its ordered visits; PyVRP |
| Geocoder | Address to coordinates; Census, with a separate ZCTA fallback |
| Travel provider | Pairwise costs and optional road geometry; estimated Haversine, imported matrix, or Valhalla |
| H3 | Geographic index for aggregation and a clustering baseline; not road distance |
| Validator | Fillrate's independent check of a candidate against the actual problem |
| Run / experiment | One immutable execution / a named collection of executions |

Road routing engines compute paths between points. The VRP solver assigns and sequences service obligations across vehicles. A road provider's optimized stop-order endpoint does not replace the fulfillment solver.

### Confirmed rules and provisional defaults

Confirmed by the primary user: one depot, piece-level allocation, 53 ft trailers, linear feet as the load dimension, unlimited truck availability, open routes, haversine × 1.2 miles, a 500-mile **per-leg** limit (depot → first stop and each stop → next stop), and a need to explore k across seeds. He picks k by trial and error today and agrees that seed stability is what he checks.

Confirmed in the design review (September 30, 2026): value ties use **net value per piece**, and orders at the same delivery location combine into one stop **only for the same customer**. Preserve these as versioned policies. Matching coordinates alone never establishes a shared customer/delivery location. Real sample rows are still pending; synthetic fixtures remain development aids.

The 500-mile rule does **not** cover cluster diameter, depot radius, or total route miles. The cluster-diameter limit (§7, §8a) is therefore an optional policy, **off by default**; everything in §7/§8a/§16 about diameter repair, validation and auto-k applies only when it is enabled. A depot service radius stays disabled unless explicitly selected (§7).

The primary user chose **whichever plan costs less** over trucks-first or miles-first. The cost objective (cost per truck + cost per mile, §8b) needs two rates; in round two he answered that he has none ("N/A"). The default objective therefore remains **truck count first, then route miles**, labeled as the fallback; the cost objective stays available when a user enters both rates. Both are visible and overridable. No answer to a questionnaire is inferred from silence.

Design for about 2,000 open orders per scenario. Clustering splits routing into per-cluster PyVRP solves; each solve is bounded by `MAX_STOPS` (default 500 stops per cluster solve) and each scenario by `MAX_ORDERS` (default 5,000 orders). Bound order lines and expanded visits separately (initial `MAX_ORDER_LINES=25,000`, `MAX_VISITS=10,000`), and reject expansion beyond these limits before allocating large matrices. These are target workloads, not promised latencies. Measure allocation, clustering, and solver performance on the deployment machine; documented tests must distinguish orders, order lines, locations, stops (visits), clusters, and matrix nodes.

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
| Road routing | Valhalla Matrix (`sources_to_targets`) and Route APIs through a server-side adapter |
| Optimization service | Python, FastAPI, Pydantic |
| Routing solver | Open-source PyVRP, pinned and capability-tested |
| Inventory optimizer | Open-source OR-Tools CP-SAT |
| Clustering | scikit-learn k-means with numpy, in the Python optimizer; `h3` (h3-py) for the H3 baseline |
| Hexagonal indexing | H3: `h3-js` in the web app for the map layer, `h3` (h3-py) in the optimizer |
| Persistence | SQLite (WAL mode) file on a mounted data volume |
| Database definitions/access | Drizzle ORM and Drizzle Kit in TypeScript, SQLite dialect, `better-sqlite3` driver |
| Job execution | Python worker supervisor with isolated child processes |
| Server data state | TanStack Query |
| Editor state | Small Zustand store; immutable scenario snapshots |
| Charts/tables | shadcn Chart/Recharts and TanStack Table |
| Testing | Vitest (Node) for web/database code, pytest for the optimizer, local headless `agent-browser` CLI for browser flows |
| Distribution | Single container image on GHCR built by GitHub Actions; Docker Compose; documented native development workflow |

Use a monorepo with apps/web, services/optimizer, packages/db, packages/contracts, examples, docs, and deployment directories. Do not add Redis, Kubernetes, a GIS server, or a second routing engine as baseline dependencies.

Next.js owns public application endpoints, internal-route authentication, database queries, and Drizzle migrations. Python owns mathematical modeling, validation/evaluation, solving, and worker process control. Only the Next.js process opens the SQLite file; Python never opens the database and does not maintain a parallel ORM schema. Drizzle is TypeScript software; do not claim it runs in FastAPI.

Python workers claim durable tasks from authenticated Next.js internal endpoints. Next.js executes transactional claim/lease operations in SQLite via Drizzle. Worker result/progress calls also go through those endpoints. FastAPI provides internal health, capability, validation, and route-evaluation endpoints; the supervisor starts alongside it. These services bind to localhost inside the container and are never exposed directly to browsers.

Bun installs dependencies and runs scripts (`bun install`, `bun run …`). The Next.js server runs on Node.js 24 LTS: `next dev` in development, and the standalone `server.js` in the container. That makes `better-sqlite3` through `drizzle-orm/better-sqlite3` the database driver. Do not use Bun-only APIs such as `bun:sqlite` or `Bun.*` in application code. On every connection, set `journal_mode=WAL`, `foreign_keys=ON`, `synchronous=NORMAL`, and a `busy_timeout` of a few seconds. Job claims run in a `BEGIN IMMEDIATE` transaction (`db.transaction(fn, { behavior: "immediate" })`) that selects the oldest claimable job and updates it with `UPDATE … RETURNING`. SQLite serializes writers, so this provides the exclusivity that `FOR UPDATE SKIP LOCKED` would provide in Postgres. Keep write transactions short, and never hold one across solver or network work. Apply Drizzle migrations at container start, before the server accepts traffic. Do not copy preview/RC installation commands blindly: prefer compatible stable releases.

MapLibre and editor/chart code are client components and dynamically loaded where useful. Secrets, Drizzle, geocoding calls, and Valhalla requests remain server-side. Generate a TypeScript API client/types from FastAPI OpenAPI; validate public inputs in TypeScript and independently in Python at the solver boundary.

### Small, explicit adapter contracts

Use typed interfaces inside the existing services, not a dynamic plugin framework or additional microservices:

| Contract | Input → output | Required metadata |
| --- | --- | --- |
| `TravelProvider` | Ordered locations + profile/options → raw matrix; optional geometry | Provider/version, dataset revision, units, reachability mask, limits, supported operations |
| `ClusteringStrategy` | Eligible location groups + spatial metric + settings → assignments and repair trace | Strategy/version, requested/raw/effective counts, seeds, diagnostics |
| `RoutingSolver` | Normalized routing problem + budget → candidate, search status, statistics | Solver/adapter version, objective definition, native/workaround restrictions |

Initially implement only estimated travel, k-means, and PyVRP. Add H3 in M4 and imported/Valhalla travel in M6. Future provider capabilities (snapping, isochrones, map matching) are optional flags, not first-release requirements. Unsupported operations have no active controls. No second routing solver is required.

## 3. Feature boundaries and capability discovery

Implementation baseline: **PyVRP 0.14.0 on Python 3.13**, already pinned in `services/optimizer/pyproject.toml` and `uv.lock`. Preserve the installed frontend and optimizer pins; do not upgrade merely to follow “latest.” Upgrade through a recorded decision, lockfile change, and passing capability fixtures. Read version-matched APIs: upstream main is not the installed release. Build small executable fixtures before exposing each feature control.

The table below is the roadmap, not a claim that the current adapter implements all native solver features. The current `loads.py` only supports one depot, one vehicle type, delivery loads, distance cost, and its tested workarounds.

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
| Routing profiles | Costing-specific directed distance/duration matrices (Valhalla `truck` by default) |
| Solver configuration | Seed, stopping criteria, statistics, and verified advanced parameters |

The primary workflow (§1) also needs these behaviors. Each records its native/preprocessing/workaround/validation provenance in the UI, capabilities document, and Python export:

| Behavior | How it is provided |
| --- | --- |
| Open routes (no return to the depot) | Proven workaround in 0.14.0: an end depot remains in the model, with zero-cost terminal return edges. Omit that synthetic return from physical legs, map geometry, mileage, and exports of planned service. Keep the raw travel matrix intact. Time-window/reload adapters require separate proof that terminal time semantics are correct. |
| Maximum leg distance (500 mi default) | Adapter discourages forbidden arcs by omitting them; PyVRP substitutes finite `MAX_VALUE`, so this is **not a native hard constraint**. Fillrate independently rejects any candidate using a forbidden physical leg. Preflight tests graph reachability; it must not simply drop every stop beyond a 500-mile depot radius. |
| Maximum cluster diameter (500 mi default) | Enforced by the clustering stage (§8a), not by PyVRP. The route validator re-checks it. |
| Geographic clustering | scikit-learn k-means before PyVRP (§8a); not a PyVRP feature. |

Verify exact cost fields, overtime fields, shipment APIs, groups, depot time behavior, warm starts, and search parameters against the pinned release. Do not simulate unsupported constraints while labeling them native.

Exclude automatic US/EU hours-of-service planning, general compatibility and arbitrary sequencing beyond native supported relationships, native fairness objectives, and native soft clustering inside the routing model. The k-means clustering stage in §8a is in scope: it is a separate preprocessing step whose clusters become independent PyVRP solves. Optional future OR-Tools routing adapters must be labeled separately and have their own feature matrix. Simple workload metrics and user-drawn selection regions are allowed; they do not imply native optimization constraints.

Expose an internal capabilities document with versions, supported input fields, search parameters, limits, and adapter versions. Each capability carries `availability: implemented | planned | unsupported`, `providedBy: native | preprocessing | workaround | validation`, fixture references, and restrictions. A fixture placeholder such as “M3” does not establish implementation. Advanced UI and Python export derive from this contract, rather than independently inventing settings.

Retain both `solverFeasible` and `validatedFeasible`. Only the latter permits operational metrics to include candidate loads. A validator rejection is an invalid candidate, not proof that the underlying instance is infeasible. Numeric penalties are search guidance, never the authority for a business constraint.

## 4. Workbench information architecture

Use a desktop-first application shell with navigation for Scenarios, Workbench, Experiments, Learn, and Settings. Add Labs only when a working lower-level tool exists (M6+); no empty navigation destinations. A scenario workbench has a primary map, editable stop/order table, configuration inspector, and route/timeline results. Use resizable panels and preserve panel preferences. Avoid a marketing landing page as the main application.

Required workbench sections: Data, Inventory, Fleet, Constraints, Travel, Allocate, Cluster, Solve, Results. The primary workflow presents Allocate → Cluster → Solve as one run with a single "Run pipeline" action; the stages remain individually inspectable. Keep basic and advanced controls distinct through progressive disclosure. Contextual explanations include plain-language meaning, units, a small example, model field, and relevant documentation.

Selecting a stop in the map/table/timeline selects the same stable ID everywhere. Selecting a route highlights its visits and associated vehicle. Filters include route, customer/order status, depot, geocoding source, allocation state, and data-quality warnings. Route colors remain stable within a comparison, with labels and patterns for accessibility.

Below tablet widths, use tabs or drawers instead of compressing four panels. Mobile supports browsing scenarios and inspecting results; complex editing is optimized for desktop. Provide keyboard controls, accessible titles, visible focus, non-map equivalents for selections, and a reduced-motion mode.

### Progressive depth

Workbench answers the fulfillment questions first: inventory allocation, clusters, trucks, and unplanned pieces. Learn contains guided, reproducible lessons. Later Labs can expose Travel/Matrix inspection, H3 exploration, and generic Solver problems using the same contracts and artifacts; they must not duplicate the business workflow or introduce another application stack. The public `/dev/components` gallery remains a design reference, not a product Lab. Production composition must satisfy [frontend-spec.md](frontend-spec.md); gallery fixtures are not implementation evidence.

### Map behavior

Use mapcn alone for map setup and components. Do not integrate [maps.black](http://maps.black), its web component, or its styles. Use mapcn's default basemap tiles for v1; there are no self-hosted tiles. Always show the tile attribution. Record the tile provider and its usage terms in `docs/basemap.md`, separate from the component's MIT license. Review the tile provider's usage terms and capacity before public launch; the private, low-traffic assumption no longer applies. No paid dependency is added by default. A custom MapLibre style URL is an advanced deployment setting for future flexibility, not a required alternate provider.

Add/edit/drag stops and depots, inspect popups, toggle route layers, fit to results, and select stops in a region. Use Turf for point-in-polygon selection and geographic calculations. Region selection is an editor action, not a road closure or solver constraint. GeoJSON layers should render bulk points/lines; reserve rich DOM markers for selected locations when needed.

An optional **H3 hex layer** aggregates stops into H3 cells at a chosen resolution (default 5, about 250 km² per cell) and shades each cell by stop count, linear feet, or allocated revenue. Cells are computed in the browser with `h3-js` and rendered as a MapLibre GeoJSON fill layer from the cell boundaries, with colors resolved through `useCssColors`. The layer is a display aggregation, not a solver input, and it keeps working for ZIP-approximate coordinates, which it labels.

Route layers clearly distinguish straight-line schematic connections from Valhalla road geometry. Geometry comes from the same recorded provider/profile/data context where possible. An imported matrix can have no road geometry. Never suggest that a pretty road route proves the solver used those roads or current traffic.

## 5. Scenario model and persistence

Scenario identity and editable metadata are separate from versioned content. Saving creates a new immutable scenario version; optimistic concurrency prevents one user silently overwriting another. Autosave shows pending/saved/conflict states. On a version conflict, offer exactly two actions: **Save my edits as a new branch**, which creates a branch from the version the user started editing and applies their edits, or **Discard my edits and reload**. Never overwrite silently or merge automatically. Branching creates a new scenario referencing its parent version. Existing runs always reference the original version and settings snapshot.

Authorship: hosted mode uses an authenticated account as owner; display names are presentation only. Local mode may retain browser display-name attribution without accounts. Existing browser identifiers are not authentication. See §14 for the account and authorization requirements.

Time model: each scenario has an IANA timezone (default taken from the browser) and a planning date, and it plans a single-day horizon. Time windows, shifts, and release times are entered as local clock times and normalized to elapsed integer seconds from the instant of local midnight on the planning date. Store the timezone and resolved offsets; reject nonexistent DST clock times and require a choice for ambiguous times. Do not equate clock-hour labels with elapsed seconds across DST changes. Late shifts may extend past midnight up to a scenario horizon end (default 24:00, maximum 48:00). The timeline and exports display local clock times; the solver receives the integer seconds. Multi-day horizons are out of scope for v1.

### Four model boundaries

1. **Business domain:** orders, lines, products, inventory snapshots, allocation decisions, and policy definitions. Contains no PyVRP objects.
2. **Spatial/travel:** locations, coordinate provenance, travel profiles, ordered matrix nodes, raw matrix artifacts and reachability. A matrix node is a location, not an order or split visit.
3. **Normalized routing:** visits, demands, service windows/durations, fleet, constraints, shipments/groups, objective definition, and references to travel artifacts. Contains no requirement for an order: synthetic solver lessons can create visits directly.
4. **Solver adapter:** maps normalized IDs/actions into PyVRP 0.14.0, derives effective matrices, records synthetic terminal actions, and maps candidate output back to normalized IDs. Independent validation consumes the normalized problem and raw costs/masks, not only solver flags.

Serialize these boundaries as versioned schemas within scenario/run documents; they need not be four databases or four services. Preserve line-piece → visit → truck lineage in both directions. Pydantic owns shared mathematical schemas; generate TypeScript contracts and use round-trip fixtures rather than hand-maintaining divergent copies.

Canonical entities and configurations:

- Location: stable UUID, label, optional original address, latitude/longitude, coordinate provenance and customer/depot roles. Service windows, duration, release time, and delivery requirements belong to visits; location-level defaults may populate them explicitly.
- Order: stable UUID, customer/location reference, order date/timestamp, priority, fulfillment policy (piece-level by default, or whole-order), required/optional status where applicable, and one or more order lines.
- Order line: stable UUID, product reference, ordered pieces (integer), net value per piece (integer cents), and linear feet per piece. The allocated amount is derived, never entered: allocated pieces × net value per piece.
- Product: stable UUID, label, discrete quantity unit (a piece), default linear feet per piece, optional mass/volume per unit, and display metadata. An order line may override the product's linear feet per piece.
- Inventory: available integer pieces by product and depot; explicit provenance and optional cost/value weights.
- Vehicle type: count (unlimited by default), capacities, supported native costs, start depot, open or closed route, shift limits, travel profile, maximum distance/duration, and native reload fields. The default is a 53 ft trailer with linear feet as its only capacity dimension, an open route, and the explicit truck-count-first objective (§8b). Unlimited means a finite safe bound of one vehicle per mandatory visit, not an unbounded solver variable.
- Shipment: pickup and delivery visits and their shared load, modeled independently from depot-stock customer orders.
- Client group: supported alternatives/restrictions with stable member IDs.
- Travel configuration: mode, circuity factor, maximum leg distance, coordinate order, profile, provider revision, scaling, distance and duration matrices.
- Clustering configuration: `strategy: kmeans | h3 | none`, fixed/auto k, seed, explicit `n_init`, H3 resolution where applicable, symmetric spatial metric, and diameter/solve-size repair policies (§8a).
- Solver configuration: seed, stopping criterion, time/iteration budget, advanced parameters, and initial solution if supported.

Units: linear feet are positive integer hundredths of a foot, so a 53 ft trailer has capacity 5,300. Money is integer cents. Parse decimals exactly at import; reject unsupported precision or preview an explicit rounding policy. Never silently turn small positive loads into zero. A single piece exceeding trailer capacity is unsplittable: report it before solving, rather than creating fractional pieces.

Do not conflate an order with a visit. In the primary workflow, allocated order lines at the same location are aggregated into one stop whose load is the sum of their allocated linear feet and whose value is the sum of their allocated amounts; the stop keeps the list of contributing lines for results and exports. A stop whose load exceeds one trailer is split into several visits of at most one trailer each, filling whole pieces greedily in the same order used by allocation; the split is recorded and shown. Combine only lines with the same depot, canonical delivery location and compatible service requirements. Other aggregations need documented handling of rewards, mandatory service, service time, and windows. Separate competing alternative visits/groups explicitly.

This greedy split fixes visit bundles before PyVRP: the solver cannot unpack them or move individual pieces between bundles. Report this limitation; a result minimizes over the constructed visits, not every possible piece packing. Keep all split visits of a location together through geographic clustering. A cluster size limit can partition visits later only with a recorded size-repair decision. Test an awkward piece-size example where greedy splitting is worse than a different packing; do not imply global bin-packing optimality.

Suggested Drizzle tables: workspaces, scenarios, scenario_versions, experiments, runs, jobs, job_events, matrix_artifacts, route_geometry_artifacts, allocation_results, cluster_results, solution_artifacts, application_settings, and geocode_cache. A single shared workspace; persistent individual preferences use the browser identifier, not an accounts system.

Use UUID primary keys (stored as text), foreign keys, timestamps, schema versions, uniqueness constraints, and indexes for scenario versions, run status/date, and claimable jobs. Store editable/versioned scenario documents and small result summaries as JSON text columns, queried with SQLite JSON functions where needed. Store large matrices and detailed outputs as versioned compressed BLOB artifacts, keyed by content hash with size bounds, so the whole application state backs up as one file. Do not store each matrix cell as a relational row or send every matrix with scenario-list requests. No object-storage service is required; maintain a replaceable artifact-store interface so a filesystem store under the data directory can replace BLOBs later if the database grows too large.

Why not browser-only storage: scenarios and experiments are shared between users, the durable job queue must be claimable by the server-side worker and survive closed tabs, and the geocode and matrix caches are shared server state. Browser storage holds only presentation preferences.

The database is a single SQLite file under `DATA_DIR` (default `/data/fillrate.sqlite` in the container, `./data/dev.sqlite` in native development). Tests use temporary database files and never point at a deployment volume. Back up with `sqlite3 .backup` or `VACUUM INTO` to a timestamped file (never by copying the live file while WAL is active), and document the restore procedure. No hosted database, provisioning, or database credential is required.

## 6. Imports and geocoding

Support CSV, canonical JSON, and GeoJSON points. The first import path (M3) is CSV for order lines (order ID, order date, location with coordinates or address, product, ordered pieces, net value per piece, linear feet per piece) and inventory (product, available pieces). Provide column mapping, sample previews, downloadable templates, row-level validation, duplicate ID checks, and a non-destructive import preview. Preserve original input alongside normalized values. Reject nonfinite coordinates, invalid ranges, negative quantities, inconsistent units, malformed windows, and conflicting group references.

Census is the initial US address geocoder. Imports use the Census **batch** address endpoint (CSV upload, at most 10,000 rows per request, chunked by the geocoding job). Single manual entries use the one-line address endpoint. The benchmark is `Public_AR_Current`. Support coordinate-only inputs worldwide. Coordinates supplied by the user take precedence unless they explicitly request re-geocoding. Cache results using normalized address plus provider, benchmark, and relevant request options. Preserve match type, matched address, raw response reference, and timestamp.

Coordinate sources: imported coordinate, manually placed, Census match, ZIP/ZCTA approximate fallback. Census interpolation is not rooftop accuracy. ZIP/ZCTA approximation is a separate fallback adapter; do not claim the address geocoder returns a ZIP centroid automatically. The fallback dataset is the Census Gazetteer ZCTA file, which is public domain. A build script downloads a pinned vintage and converts it to a compact lookup bundled in the image. Each approximate coordinate records the provenance `zcta-gazetteer-<vintage>` and uses the ZCTA internal point. ZIP codes with no ZCTA, such as PO-box-only and unique ZIPs, remain unresolved. Document the ZIP-versus-ZCTA distinction in the import help. Never invent confidence scores.

Default: allow fallback with a visible review warning. Settings can disable it or exclude approximate stops. Missing coordinates remain unresolved; never silently use (0,0). Show fallback counts before solve. Allow map corrections with undo. Keep original and corrected coordinate provenance.

## 7. Travel matrices and Valhalla

Supported modes:

1. Haversine distance multiplied by a circuity factor (default 1.2, the primary user's current "mileage cushion"), with an explicitly configured constant-speed duration estimate; the label always says estimated/schematic and shows the factor.
2. Valhalla directed road-network distance and duration matrices (`truck` costing by default).
3. Imported directed matrices with node order, units, profile, and metadata.

Default global mode is Haversine × circuity factor, which matches how the primary user measures miles today and needs no road server. Separate three concepts explicitly: **leg distance** uses the selected directed travel matrix; **cluster diameter** uses a symmetric spatial metric (default haversine × clustering circuity 1.2); **depot service radius** is a separate optional policy, disabled by default. With default estimated travel all distances agree with the confirmed haversine × 1.2 convention. Changing road travel does not silently change the cluster metric. Store both metrics and their factors independently; a UI action can explicitly change both.

A 500-mile leg limit applies to depot → first visit and each consecutive physical visit, not the synthetic terminal return. It is not a 500-mile total route limit. For example, depot → A = 400 mi, A → B = 200 mi, depot → B = 600 mi permits A → B when capacity and other constraints allow it. Do not exclude B merely because direct depot travel exceeds 500 mi.

Build the directed allowed-edge graph from reachable raw travel edges satisfying the limit. After clustering, no directed path from the depot to a required visit within that cluster proves it unreachable in that partition. A path is only a necessary condition: capacity and service constraints may still prevent a valid route. Diagnose `unreachable_in_partition` separately from physical/provider unreachability and suggest a different k; do not silently use a visit in another cluster as a bridge. Preserve allocation and show affected pieces as allocated but unplanned. An enabled service-radius policy uses the recorded symmetric spatial metric, is applied before allocation, and can exclude stops explicitly, with recorded reasons; it is not inferred from the leg limit. Valhalla remains optional and arrives in a later milestone (§15); its coverage is whatever region the deployment built, so stops outside it are unreachable, not approximated. Require a configured endpoint before selecting it. Curated road lessons may ship recorded matrices and corresponding metadata. Public Valhalla demo servers are not the batch infrastructure for 500-stop experiments.

Default internal units: meters, seconds, integer quantities, and integer cents for money. UI defaults: miles and minutes; support kilometers and alternative display units. Business values and optional visit rewards are cents. The initial load solver's objective is distance-equivalent integer meters, including its fixed truck penalty; it is not a monetary cost estimate. §8b defines the first-release objective. Later monetary objectives explicitly accept cents per truck, distance rates per mile/kilometer, and duration rates per hour, converting at the boundary with a recorded scale factor to avoid rounding rates to zero. Never mix a meter-valued truck penalty with cents-valued revenue. Round/scale once at the solver boundary, preserving raw provider matrices and effective solver matrices. Validate safe ranges against the pinned solver constants.

Valhalla Matrix requests are bounded by the pinned server configuration and need block partitioning. Upstream configuration currently lists truck defaults of 2,500 pairs and 400,000 m maximum straight-line separation; these are request limits, not Fillrate business constraints ([configuration source](https://github.com/valhalla/valhalla/blob/master/scripts/valhalla_build_config)). Verify effective limits for the deployed image. Reassemble by stable source/destination IDs; preserve asymmetry and zeros on the diagonal. Choose a configurable default block size of 50 sources and 50 destinations, then adapt to endpoint capability and coordinate limits. Limit concurrency, support cancellation and retry transient failures, and report progress based on completed blocks.

Valhalla chooses the vehicle model per request (the `costing` and its `costing_options`), so changing the vehicle does not require re-preparing data. The default costing is `truck`. Its `length` is the whole combination (Valhalla's default of 21.64 m is about a tractor with a 53 ft trailer); height, width, weight, and hazmat use Valhalla defaults unless the scenario sets them. The costing and its options are part of the matrix identity. Road deployments use a pinned image, recorded OSM extract dates, and documented coverage.

The v1 road provider is an optional self-hosted Valhalla service in the same Compose project (profile `valhalla`). It uses a pinned `ghcr.io/valhalla/valhalla-scripted` image, which builds routing tiles from the OSM extracts in its mounted volume on first start and rebuilds them when the extracts change. Coverage (one or more Geofabrik regions, up to the whole US) is chosen at deploy time and recorded in `docs/decisions.md` with the measured build time, disk, and memory; it should span at least the maximum leg distance around the depot. `deploy/valhalla/prepare.sh <geofabrik-region-path>...` downloads the extracts, writes `extract-meta.json` with the source URLs, extract dates, and image tag, and sets the service limits. Raise `max_matrix_distance` to accommodate the actual requested point extent, not just the longest allowed route leg: a depot and an indirectly reachable stop can be farther apart than that limit. A 1,000 km setting is a starting point, not a universal guarantee. Distinguish request rejection from an unreachable pair, and keep pair/block limits consistent. Route geometry has its own location limits; chunk long inspected routes without resequencing, and record any segment discrepancies. The app reads `VALHALLA_URL` (for example `http://valhalla:8002`) and an optional `VALHALLA_COSTING_LABEL`; the health view shows the dataset metadata. Stops outside the covered region surface as unreachable edges, never as silent fallbacks.

Unreachable edges remain unreachable. Default behavior blocks the affected partition when a required visit has no allowed path from its start depot; a single missing pair does not invalidate an otherwise routable instance. Optional visits get a documented exclusion or supported graph representation. Any Haversine fallback is an explicit experiment setting and records affected edges. Do not silently combine road and straight-line costs.

Cache immutable matrix artifacts by ordered coordinates, provider/profile identity, dataset revision (from `extract-meta.json` for self-hosted Valhalla), options, and conversion policy. Coordinate edits invalidate the relevant cache. Route geometry is cached separately and fetched only for inspected solutions. Resolve and persist all effective costing defaults and graph build/config hashes, not merely an OSM date. Static road matrices are the initial supported road mode; dynamic traffic and time-dependent optimization remain deferred. A provider distance is the length of its chosen costed path, not necessarily the geographically shortest road path. Matrix inspector displays a virtualized table/heatmap, unreachable edges, symmetry differences, and units.

## 8. Inventory allocation experiments

The first release includes multi-product data and **piece-level allocation**: an order line can be partly filled, in whole pieces, when stock is short. This is the primary user's model and the v1 default. Whole-order allocation (every line of an order filled in full, or none) becomes a selectable policy in M5. An order with excluded/ineligible lines is excluded as a whole in that mode; never silently fill only its eligible subset. Hide unavailable modes rather than providing inert controls.

Allocation strategies (the default ships in M1; additional strategies and whole-order mode arrive in M5):

- **Order date, then value (default):** sort open order lines by order date ascending, then net value per piece descending, then stable ID. Walk the list and allocate `min(remaining ordered pieces, remaining stock)` of the line's product. Deterministic.
- First-come: order date, then stable ID (no value tiebreak).
- Priority: descending priority, then order date, then stable ID.
- Proportional (fair-share greedy): for each depot and product, compute the fill ratio `r[d,p] = min(1, stock[d,p] / demand[d,p])` and give each customer a target of `r` times their demanded pieces. In piece-level mode, allocate floor(target) per line and distribute the remaining pieces one at a time to the customer with the lowest fulfilled-to-target fraction, breaking ties by order date, then value, then stable ID. In whole-order mode, repeatedly accept, among orders that still fit, the order whose customer is furthest below target, with the same tiebreaks. Define customer identity explicitly. Zero-target customers are skipped, and zero demand yields zero allocation without division. Label it a heuristic.
- Optimized: OR-Tools CP-SAT chooses integer allocated pieces per line (or whole orders) under per-product/per-depot stock constraints. Implementers should follow the CP-SAT Primer (§19) for modeling, hints, and solver parameters.

Default optimized objective: maximize total allocated amount (revenue, in cents). An optional "respect order date" constraint forbids shorting an older line of a product while a newer line of the same product receives pieces. A lexicographic priority objective (maximize weighted priority, then allocated amount) remains available: priority is a positive integer from 1 to 100 (default 1). Each stage has its own time limit (default 10 seconds) and reports its own CP-SAT status. If an earlier stage is not proven optimal, the next stage constrains its value to at least the best found and says so. Do not mix dollars, miles, and quantities without explicit normalization. Provide tradeoff summaries rather than a misleading single universal score.

For each line l and candidate depot d, use an integer variable `a[l,d]` in `[0, ordered[l]]` (a binary `x[i,d]` per order in whole-order mode, with every line of the order tied to it). For each line, sum over depots cannot exceed ordered pieces; use order-level depot-selection variables to enforce that at most one depot supplies every selected line of an order. Whole-order selection fixes every line quantity to its ordered quantity at the chosen depot. For every product p and depot d, the sum of allocated pieces is at most `stock[d,p]`. If depot-specific dispatch cannot be represented by the selected PyVRP model, solve accepted orders in explicitly partitioned depot subproblems and report the partitioning limitation. No hidden cross-depot sourcing or stock borrowing. The primary workflow has one depot.

In whole-order greedy mode, process only complete orders that fit remaining stock for every product; date/value sorting uses order date, then total order net amount descending, then stable order ID. This is an explicit policy distinct from the piece-level value tiebreak. If an order does not fit, skip it and record the short products. Minimum shipment quantities per line remain deferred (§17).

Default staged flow: allocate → aggregate allocated lines into stops → cluster (§8a) → mark allocated stops mandatory for that routing experiment → solve per cluster. If no validated feasible solution is found, preserve the allocation and report the specific search/preflight/validation outcome; do not count accepted stock as delivered. Users can branch allocation, fleet, or constraints and rerun. A later route-aware repair loop may return stock and choose different orders, but is not claimed as joint optimization. With allocation held fixed and every allocated piece planned, changing k or solver seed cannot increase planned revenue; it only changes grouping, trucks, mileage, or feasibility. Explain this invariant in comparisons.

Optional-client prize-collecting lessons are separate from stock-allocation selection. Model adapters enforce inventory bounds even if an experimental mode later makes allocated visits optional. Report ordered, allocated, planned-on-validated-trucks, and unplanned pieces separately, by product, each with its amount in cents. Use “planned revenue,” not delivered revenue. Playback may show a simulated service state but never changes business fulfillment totals. Depot reloads cannot create stock. Default stock experiment adapter rejects unsupported reload/sourcing combinations with a clear explanation rather than making an invalid model.

Do not count modeled pickup quantities as newly available depot inventory unless an explicitly supported inventory transfer model is implemented. Each strategy's output includes allocation decisions, residual stock, objective components, status, runtime, and heuristic/solver provenance. CP-SAT status must distinguish feasible from proven optimal and infeasible from unknown.

## 8a. Clustering and iteration pipeline

A pipeline run executes these stages against immutable snapshots; each output is stored and inspectable:

1. **Preflight:** resolve units/policies and reject invalid imports; explicitly exclude unresolved/disallowed coordinates from eligible demand, preserving input and reasons. Never consume stock for excluded demand. Apply an optional service-radius policy only when configured.
2. **Allocate:** select pieces and record residual inventory (§8).
3. **Aggregate:** build compatible location groups and whole-piece visit bundles (§5).
4. **Cluster and repair:** partition distinct location groups, then deterministically repair excessive diameter or solve size. Store original and final assignments and the reason for each split.
5. **Build travel/problem:** resolve matrices for unique locations per partition, construct allowed-edge masks, check reachability, and create normalized routing problems. Distinct visits at one location share a matrix node.
6. **Solve:** one PyVRP problem per cluster, required visits, bounded fleet, and explicit objective (§8b). No truck crosses cluster boundaries.
7. **Validate:** independently check coverage, piece lineage, load, physical legs, diameter, and reconstructed metrics.
8. **Summarize:** reconcile stock and all piece quantities, show valid loads and diagnostics, and compute comparison metrics (§10).

The dependency graph is `preflight → allocate → aggregate → cluster → per-cluster travel/problem → solve → validate → metrics`. Travel is independently cacheable by locations/profile; the spatial distances used in clustering do not depend on a road matrix. Scheduling can execute several stages in one worker task; an artifact boundary need not create another queue job (§9).

### Clustering policy

`strategy: kmeans` is default. Use scikit-learn KMeans on 3D unit vectors from latitude/longitude, with one equally weighted observation per canonical location group, seed 0, explicit `n_init=10`, `init=k-means++`, and recorded algorithm/tolerance/iteration settings. This minimizes squared Euclidean chord distance in feature space; it is not spherical k-means, a road-mile objective, or capacity-constrained clustering. Loads inform routing and diagnostics, not the initial location weights.

Record `requestedK` (null for auto/H3), `selectedK` for auto, `rawClusterCount`, and `effectiveClusterCount` after repair. Canonicalize labels from sorted member IDs so colors and exports do not depend on arbitrary k-means label numbering.

For diameter repair, compute the largest pairwise **symmetric spatial distance** (§7), then bisect oversized groups with deterministic 2-means. For solve-size repair, count visits (including splits), not orders or matrix nodes, against `MAX_STOPS`. Record each reason independently. Bound repair iterations; if duplicate coordinates cause a degenerate split, use a documented stable-ID partition fallback for size repair. Never recurse without shrinking a partition. These repairs can worsen load quality and graph reachability; report that consequence. A single location's many visit bundles may require size partitioning.

**Choosing k:** fixed k, or auto. Auto searches k=1 upward, capped by `min(25, number of distinct feature vectors)` by default, and selects the first observed partition satisfying diameter and solve-size limits before repair. The heuristic's result is not a proof of the smallest feasible partition count; feasibility is not assumed monotone in k. If no candidate passes, repair the final candidate and show “auto limit reached; repaired.” Handle zero eligible visits as a successful empty plan with undefined fill percentages; one location needs no k-means fit. Reject fixed k above the number of distinct feature vectors with an actionable error.

**Cluster stability.** The primary user chooses k by trial and error today, rerunning k-means to reduce run-to-run variance until stop groupings are trustworthy. The workbench supports this directly with a **k explorer**, which runs clustering only (no allocation changes, no PyVRP) for a range of k and a list of seeds (default 0–9), and shows:

- **Per k:** unweighted feature-space squared-error sum as an elbow chart, raw/effective cluster counts, diameter/size-repair counts, and **stability**: the mean adjusted Rand index between every pair of seeds' assignments. Higher means the grouping doesn't depend on the seed.
- **Per location, at the selected k:** **seed agreement**. Build the co-assignment matrix (for each pair of location groups, the share of seeds that put them in the same cluster). A location's agreement is its mean co-assignment with the other locations in its cluster in the reference assignment (the chosen seed, default 0). Co-assignment ignores cluster labels, so label order across seeds doesn't matter. The map colors locations by agreement, so seed-sensitive assignments stand out. Label this **seed agreement**, not probability of correctness. A singleton reference cluster has no peers: report N/A, not 100%. Expose raw and diameter-repaired statistics separately, using the same location population across seeds. Compute these before visit-level size splits; size repair is a separate diagnostic and must not force one location into several statistical labels. ARI can be negative; do not clip it to \[0,1\]. Compute co-assignment in bounded blocks or on demand, and do not ship a dense all-pairs array to the browser.

**H3 baseline.** As an alternative to k-means, the cluster stage can group stops by their H3 cell at a chosen resolution (`strategy: h3`, default resolution 2, average hexagon area about 87,000 km²; k-means stays the default). Cell membership is deterministic for fixed coordinates, resolution, and library version; it serves as a stable baseline. Cell area varies and the grid includes pentagons. H3 cell membership does not guarantee capacity, road connectivity, or a maximum diameter. Each non-empty cell becomes a cluster, and the same diameter/size repair applies with a fixed recorded repair seed. The k explorer shows H3 resolutions 1–3 beside the k range with a consistently computed feature-space squared-error sum and repair counts (seed stability is labeled “deterministic / not applicable,” not presented as evidence of better clustering), and sweeps may vary the method and resolution. The method, resolution, and `h3` library version are recorded like k and the seed.

The user picks k (and optionally a seed) from the explorer, and that choice feeds pipeline runs and sweeps. Inertia, stability, and seed agreement are descriptive statistics, labeled as such; they are not solver objectives. The explorer's clustering-only runs are durable jobs like any other and count toward `MAX_SWEEP_RUNS`.

**Iterations are experiments.** A sweep varies any of: clustering method (k-means or H3), k (a range), H3 resolution, k-means seed, PyVRP seed, inventory percentage, allocation strategy, fulfillment policy, circuity factor, and the distance limits. The default maximum sweep is 25 runs (`MAX_SWEEP_RUNS`).

**Metrics** are shown side by side; there is no hidden composite score. Define geographic centroids by normalizing the mean 3D unit vector (fall back to the spatial medoid with stable-ID tiebreak if the mean is degenerate). Tightness averages one distance per eligible location group, using the declared symmetric spatial metric, rather than weighting split visits multiple times:

- Truck fill: fill % per truck (loaded linear feet / capacity), average and minimum fill, and trucks used.
- Cluster tightness: widest pair distance, mean distance to the cluster centroid, loaded miles (depot to last stop, open route), and, when the run's k came from the k explorer, that k's stability score.
- Revenue: planned amount on validated trucks, compared with allocated and ordered amounts.

Pareto comparisons operate on explicit scalar metrics, not vague metric groups: default maximize planned revenue, maximize fleet utilization `sum(load)/sum(capacity of used trucks)`, and minimize mean location-to-centroid spatial distance. A dominates B only if it is no worse in every chosen metric and strictly better in at least one, using declared rounding/tolerances. Minimum truck fill, truck count, total route miles and maximum diameter remain visible; users can choose a different comparison vector and save it. Undefined metrics, invalid plans, and incompatible cohorts are excluded from automatic ranking (§10). For identical trailers and a fixed total load, average utilization and truck count are redundant; do not double-weight them.

Clustering is a decomposition choice, not a guarantee of better loads. In M4, offer a **no-clustering baseline** only when all visits fit `MAX_STOPS`; the cluster-diameter rule then applies to the single cluster and can make it ineligible. Show the capacity lower bound `ceil(total load / capacity)` and the sum of per-cluster bounds. Their difference is the increase in the capacity lower bound, not proof of how many extra trucks partitioning actually requires; neither proves the best truck count when fixed bundles or constraints intervene. For larger instances report bounds without pretending to have solved an unrestricted baseline.

## 8b. Truck objective and quality claims

The default objective is lexicographic: among validated plans for the **same mandatory visits**, prefer fewer trucks, then shorter physical distance. This is a problem objective, not a guarantee that a heuristic finds its global optimum.

For the initial one-depot, homogeneous, open, distance-only model, implement this with a **derived dominance penalty**, not an arbitrary large cost. If there are n mandatory visits and the allowed physical-leg bound is L integer meters, a feasible open solution has n physical legs, so its distance is at most `B = n × L`. Set fixed truck penalty `F = B + 1`; objective is `F × trucks + physical distance`. Thus every feasible solution with fewer trucks outranks any feasible solution with more trucks. Record B, F, units, and the proof's assumptions. Check edge and total-objective ranges against pinned solver bounds; reject unsupported ranges rather than overflowing or silently weakening precedence. When a tighter bound is used, record its derivation.

That scalarization orders **feasible** solutions only. Missing-edge penalties and solver infeasibility penalties must never override independent validation. The current spike defaults its fixed penalty to zero; integrating this objective is M1 follow-up, not already implemented. When trips, optional visits, or monetary rates change the assumptions, disable this adapter mode until a new bound or staged strategy is proven. A heterogeneous fleet of vehicle types (M6) keeps the bound: every type carries the same F = n·L + 1, so any feasible plan's distance stays below F whatever the types and the truck count still dominates (see docs/decisions.md, "Fleet counts are fleet-wide").

An advanced `weighted_distance` mode uses an explicit fixed penalty measured in equivalent miles/meters per truck, plus route distance. Require a user-supplied nonnegative penalty (zero is valid and means distance only); explain that an extra truck can win if it saves enough miles. Do not call the penalty a dollar cost. A monetary `cost` objective (integer cents per truck plus cents per mile) is the primary user's stated preference and lands in M3. For the current one-depot, homogeneous, open, distance-only model it is `weighted_distance` with penalty = truck cost ÷ mile cost, so it reuses that adapter; the UI shows dollars and records both rates and the conversion scale. Duration rates and heterogeneous fleet costs stay in M6.

Report `bestFoundTruckCount`, the capacity lower bound, validated distance, objective mode, and search budget. Equality with a valid lower bound certifies truck count only, not optimal route miles; otherwise label it “best found.” Always expose the heuristic status. Truck fill and allocation revenue are outcomes; they are not secretly extra PyVRP objectives.

## 9. Solve execution and durable jobs

Create a run from an immutable scenario and resolved settings snapshot, preserving every derived artifact it uses. Public POST operations support idempotency keys. Each run has one or more durable jobs, dependencies, input hashes, and attempts. A top-level run stores the immutable input/settings snapshot first; allocation and matrix outputs are attached later by immutable artifact references, rather than requiring those outputs to exist at run creation.

States: queued → claimed → running → succeeded, failed, cancelled, or interrupted. Keep cancellation request separate from final status. A claim has a lease token, worker identity, expiry, and heartbeat; completion accepts only the current lease and attempt. Transactional claims prevent duplicate workers. A crash expires the lease; bounded retry records the prior attempt and reason. Permanent validation failures are not retried.

A pipeline run (§8a) records a stage manifest and per-cluster results. M1 may execute the graph sequentially in one leased pipeline job; M3 can fan out per-cluster solves without changing artifacts. A failed cluster makes the whole required plan invalid; validated results from other clusters remain inspectable as a partial plan, never a silently successful fulfillment.

### Stage artifacts and reuse

Each artifact has `stageType`, `schemaVersion`, `inputHash`, `outputHash`, producer/adapter versions, parent artifact hashes, effective settings, and creation metadata. Compute input hashes from a canonical serialization of actual dependencies (stable IDs/order, exact numeric representation, relevant versions/settings). Validate payload hashes before reuse. Record which artifact supplied a cache hit; never silently substitute a fresh calculation for the recorded one.

- Changing only a routing seed reuses allocation, aggregation, clustering, and matching travel matrices.
- Changing k reuses allocation/aggregation; road blocks may be reused where ordered location/profile identities match. Extracting a submatrix records its parent hash and node mapping.
- Changing inventory invalidates allocation and its descendants; unchanged location/profile travel artifacts remain reusable.
- Changing cluster circuity invalidates cluster assignments; changing road profile invalidates travel/problem/solve, not an unchanged independent spatial partition.
- Changing only display units/theme invalidates no mathematical artifact.

Content addressing identifies inputs and actual output; it does **not** promise a unique output for stochastic or time-limited solving. By default reuse deterministic preprocessing and matrix artifacts, but run each requested solver replicate anew with a distinct execution/attempt ID. Explicit reuse of an existing solve must be labeled as reuse and excluded from independent-sample statistics. Seed, budget, thread settings, versions and platform belong to execution provenance. Cache writes finalize atomically; cleanup cannot delete artifacts referenced by saved runs.

Default worker concurrency: one solve process, with a bounded queue. Default solver search budget: 10 seconds per cluster in pipeline runs and 30 seconds for single-problem lessons; expose 5/10/30/120-second presets and an advanced budget. Deployment hard limits: 300 seconds per solve attempt and 600 seconds per pipeline run (`RUN_WALL_LIMIT_SECONDS`), distinct from solver search time. Default lease 60 seconds, heartbeat 10 seconds; configurable in deployment. Allow small bounded concurrency for geocoding/matrix I/O separately from solver CPU. Before submission, preview cluster count, expanded seed/k runs, and an estimated upper budget; cap every stage by remaining run time. A deadline exhaustion is `budget_exhausted`, not proven infeasibility. The k explorer defaults to two valid k candidates near the selected k (or 1 and 2) × seeds 0–9, at most 20 clustering tasks. Preview expanded task count before enqueueing; a requested k=3–12 × 10 seeds is 100 tasks and requires a smaller explicit selection or a raised deployment allowance. Never silently truncate or count only the outer sweep. Internal auto-k trials have their own bounded loop within a task; report those fit counts too.

Cancellation kills the solver child process when cooperative interruption is unavailable, releases resources, and persists the cancellation. No solver call may block FastAPI's event loop or a Next.js request. Page refreshes and web restarts retain queued/completed runs. Worker reconnects must not overwrite a newer attempt.

Poll run summaries initially; refresh active jobs around every two seconds, with backoff and pause when appropriate. Use coarse persisted progress events, not per-iteration database writes. Read final solver statistics for convergence charts. Do not invent live route snapshots or search telemetry that the pinned API cannot provide.

Random seed is recorded. Iteration-based stopping is preferred for reproducibility lessons; time-based stopping is convenient but does not guarantee identical results on different machines. Capture versions, platform, budgets, scaling, matrices, and warnings.

## 10. Results, evaluation, and comparison

Pipeline results exist to replace manual interpretation. For every pipeline run, show:

- **Cluster cards:** stops, trucks, loaded linear feet, average and minimum fill %, widest pair distance, and revenue, per cluster.
- **Truck loads:** per truck, the stop sequence and the order lines on board (pieces, linear feet, amount), with fill % and loaded miles.
- **Map:** stops colored by cluster, cluster hulls, and truck paths (straight-line, labeled schematic).
- **Unplanned pieces with evidence:** excluded input/policy; stock shortage; oversize indivisible piece; unreachable in the cluster; candidate validation failure; or no valid candidate before budget exhaustion. Attach stage, affected quantity, reason code, and evidence. Greedy allocation can identify earlier winning lines; a CP-SAT tradeoff is not explained by inventing a priority trace. “Did not fit” requires a concrete violated bound, not merely a heuristic timeout.
- **Run summary:** the three metric groups from §8a and the run's settings.

For single-problem runs and lessons, show best solution found, feasibility status, objective breakdown, routes/vehicles used, total distance, duration, travel/wait/service time, visit counts, capacity utilization, allocation/fulfillment by product, and workload distribution metrics. Distinguish nominal cost from infeasibility penalties and missing optional rewards according to PyVRP semantics. Do not call the solution optimal without proof.

Route inspection shows ordered visits, depots/reloads, arrival/service/departure, window slack where supported, and load before/after service. A playback cursor interpolates along road geometry using planned travel duration; it is a simulation without live traffic or GPS. Drive, wait, and service states appear on both map and timeline.

Manual baseline editing supports visit reorder and vehicle assignment. Evaluate with the same matrices and constraint semantics before comparing. Invalid manual solutions show concrete violations; saving a manual baseline does not imply solver feasibility. Warm starts are enabled only when supported and validated.

Preflight diagnostics identify provable issues: indivisible demand exceeding capacity, invalid windows, missing nodes, zero available vehicles, inconsistent shipment/group definitions, and unreachable required visits. Missing individual edges alone do not prove an instance infeasible. A solver timeout without a feasible solution does not prove mathematical infeasibility. Diagnostics about skipped optional stops are observed tradeoffs, not invented explanations of solver intent.

Experiments compare multiple seeds and budgets against the same scenario/matrix snapshot. Default seed list: 0, 1, 2, 3, 4; a single run defaults to 0. Show best/median/range, feasible-run count, wall time, and fulfillment. Sweeps support the pipeline parameters in §8a plus vehicle count, selected capacity, optional reward, and runtime. Default maximum sweep: 25 runs; configurable hard limits. The iteration comparison table lists one row per run with truck fill, tightness, revenue, trucks, k, and the varied settings, and marks the non-dominated runs.

Comparison views include synchronized maps, configuration diffs, convergence charts, and tabular metrics. Comparisons with different matrices, objectives, allocations, or versions display those differences; raw solver scores from incompatible objectives are not ranked as equivalent. Operational metrics can be shown with changed-assumption warnings; road and estimated miles are not interchangeable measurement systems.

Persist a `problemFingerprint` over normalized visits/demands, required/optional semantics, fleet, raw/effective matrix identities, constraint policies, and objective definition/scaling. Solver-vs-solver objective ranking requires matching fingerprints; solver identity and seed are provenance, not part of the mathematical problem. Adapter transformations must demonstrate semantic equivalence before comparing native objectives.

**Ranked options (round two).** The primary user wants comparisons to answer "best option, 2nd best, 3rd". Among validated complete plans in one comparable cohort, show the top three as **Best option**, **2nd best** and **3rd** using a declared, visible lexicographic order, not a hidden weighted score. Default order: best trade-off (non-dominated) runs first, then planned revenue (higher first), then shipments (fewer first), then loaded miles (fewer first). The ordering is shown beside the ranking, can be changed and saved with the comparison vector, and is included in exports. Ties at the declared rounding share a rank. Runs outside the cohort, invalid or partial plans are not ranked.

For pipeline tradeoffs, derive a separate `comparisonSignature`: demand/inventory population, unit/value definitions, eligibility policy, metric definitions, and validation rules. k and seed may vary within this cohort; inventory changes form a changed-assumption cohort. Side-by-side inspection is always possible, but automatic Pareto/rank summaries default to validated complete plans in one comparable cohort. Include the compared settings and metric directions in exports. Separate job execution state (`succeeded`, etc.), candidate validity, coverage (`complete | partial | empty`), and proof status (`heuristic | proven_infeasible | proven_optimal` with scope). A completed job is not automatically a valid or complete plan.

For each product: ordered = excluded + eligible; eligible = allocated + allocation-unselected; allocated = validated-planned + allocated-unplanned; starting inventory = allocated + residual (pieces per depot/product). Demand amounts use each line's net price; residual inventory has no implied revenue valuation when lines have different prices. Demand counts and amounts reconcile without double-counting a line split across trucks. Failed partitions contribute no planned revenue from invalid candidates. Show null/N/A ratios when denominators are zero.

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
| Maximum cluster diameter | 500 mi (symmetric spatial miles; haversine × 1.2) | Workspace/scenario/run |
| Depot service radius | Disabled; explicit separate policy | Workspace/scenario/run |
| Trailer | 53 ft, linear feet only, open route, unlimited count | Workspace/scenario/run |
| Estimated speed | 25 mph, clearly labeled | Workspace/scenario/run |
| Clustering method | k-means (H3 baseline optional, resolution 2) | Workspace/scenario/run |
| Valhalla endpoint/costing | From `VALHALLA_URL`; `truck` costing; unconfigured if unset | Deployment (env) |
| H3 map layer | Off; resolution 5; shaded by stop count | Browser preference |
| Basemap | mapcn default | Workspace |
| Custom MapLibre style URL | Optional, empty; must match `MAP_STYLE_ALLOWLIST` | Workspace |
| Geocoder | Census for US addresses | Workspace/scenario |
| ZIP fallback | Enabled with review warning | Workspace/scenario |
| Approximate-coordinate inclusion | Include with warnings | Scenario/run |
| Solver seed | 0 | Workspace/scenario/run |
| Search time | 10 seconds per cluster (pipeline); 30 seconds (single problem) | Workspace/scenario/run |
| Solver objective | Truck count first, then distance; derived penalty (§8b) | Scenario/run |
| Allocation strategy | Order date, then value; optimized comparison available | Workspace/scenario/run |
| Order fulfillment | Piece-level; whole-order selectable | Scenario/run |
| Optimized allocation objective | Maximize allocated amount | Scenario/run |
| Cluster count (k) | Auto: first passing candidate up to min(25, distinct feature vectors), then repair | Scenario/run |
| k explorer seeds | 0–9 | Workspace/scenario |
| k-means seed | 0 | Workspace/scenario/run |
| Comparison seeds | 0–4 | Workspace/experiment |
| Order limit | 5,000 orders per scenario | Deployment hard limit (env `MAX_ORDERS`) |
| Stop limit | 500 stops per cluster solve | Deployment hard limit (env `MAX_STOPS`) |
| Maximum sweep | 25 runs | Deployment hard limit (env) |
| Worker concurrency | 1 solve | Deployment |
| Wall-clock hard limits | 300 seconds per solve attempt; 600 seconds per pipeline run | Deployment |
| Artifact retention | Keep saved runs; explicit cleanup | Workspace (Administration) |

There are no roles: everyone who can reach the app is trusted (see §14), and the Administration section is simply where rarely-changed workspace settings and cleanup actions live. Deployment hard limits and provider endpoints come only from environment variables and are shown read-only in Administration. Keep any configuration value out of settings JSON and out of browser forms that echo it. The server never fetches a URL a user typed unless it matches the env-configured `VALHALLA_URL` or `MAP_STYLE_ALLOWLIST`, so the app cannot become an open URL fetcher. Do not expose worker concurrency and lease internals in ordinary lesson controls.

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

Python exports run without web application credentials and reproduce the experiment pipeline. The replay bundle's checks are tested Python (`fillrate_optimizer.replay`): deterministic stages must reproduce (measured runtimes are provenance, not results), allocation strategy/policy and validity always match, and solver metrics are required only for iteration-budget runs. A k explorer job has its own bundle (`fillrate_optimizer.explorer_replay`): counts, labels and identifiers must match exactly, floating-point statistics (inertia, stability ARI, seed agreement) within a relative 1e-9, and it declares only the spatial metric. Until M6 selects road matrices, bundles declare estimated travel and refuse any other provider. Include secrets-free provider metadata and cached matrices rather than requiring live geocoding/routing calls. Explain time-budget variability and support an iteration-based reproduction mode. VRPLIB import/export is a later feature until the supported rich-variant subset is validated; JSON is the canonical lossless format.

## 14. Deployment, access, and operations

The target deployment is a publicly accessible website backed by Docker Compose running the single `ghcr.io/timblazing/fillrate` image with a mounted data volume, plus an optional Valhalla service. `FILLRATE_MODE=hosted` now serves GitHub accounts with request-only signup, owner isolation and quotas. The owner signed in successfully on the live site; the configured numeric admin ID is linked to an approved account. Cross-account denial and quotas passed automated tests against a production build, but cross-account behavior was not exercised with two live GitHub accounts. Initial native development uses Bun for web and uv for Python dependency environments. Provide .env.example; local mode needs no auth credentials, while hosted mode requires its auth configuration.

Existing runtime environment variables (hosted auth configuration is additionally required):

- `DATA_DIR` (default `/data`).
- `WORKER_TOKEN`, generated randomly at startup when unset, since both processes share the container.
- `VALHALLA_URL` and `VALHALLA_COSTING_LABEL`.
- `MAP_STYLE_ALLOWLIST`.
- Hard limits: `MAX_ORDERS`, `MAX_ORDER_LINES`, `MAX_VISITS`, `MAX_STOPS` (per cluster solve), `MAX_SWEEP_RUNS`, `SOLVE_WALL_LIMIT_SECONDS`, `RUN_WALL_LIMIT_SECONDS`, `SOLVE_CONCURRENCY`.
- `PORT` (default 3000).

Local mode needs no third-party secrets; hosted GitHub OAuth requires credentials and an auth secret. The Census geocoder requires no key. Never put server-only values in NEXT_PUBLIC variables.

### Hosted accounts and local mode (v1.10)

The free hosted service retains server-side SQLite scenarios, immutable versions, jobs and results. Use Better Auth with Next.js and the Drizzle SQLite adapter for account/session handling. Start with GitHub OAuth to avoid an email delivery/password-reset service; retain a provider-neutral user ID. Authentication is required for hosted personal scenario imports, saved data, runs, sweeps, geocoding, matrices and private exports. Hosted pages are limited to the landing page, privacy, `/dev` and `/dev/components` for unauthenticated visitors. Lessons and all product pages require authentication and approved access. The landing hero starts GitHub authentication under “Request access”; authenticated pending users can reach `/request-access`. Anonymous API demonstration budgets remain separately bounded. Account registration is free; no subscriptions or billing are planned.

Authorization belongs in server endpoints and database queries, never in browser IDs or UI visibility. Bind scenarios, versions, jobs, artifacts, experiments, travel snapshots and exports to an authenticated owner. Check ownership on list/read/write/download/cancel, cache reuse, replay and worker job admission; guessed IDs and content hashes must not expose another account's data. Do not automatically claim existing operator data for the first signup. Keep it operator-only pending an explicit migration. Python remains a private worker and never opens SQLite.

Better Auth's auth-route limiter does not limit solver APIs. Add persistent application admission controls per account and trusted-proxy IP, plus global queue/concurrency caps, upload/body/row limits, maximum solve/sweep time and size, cancellation and quota accounting, including geocoder/Valhalla budgets. Initial configurable starting defaults: one active job per account, ten queued jobs globally, twenty solve admissions/account/day, ten MB uploads and existing 2,000-order and solver wall limits; one sweep counts each admitted child run. Validate and tune against target-hardware evidence (spec §15 and `docs/release-verification.md`) before public signup. Return clear 429/quota messages and reset times. Do not trust arbitrary forwarded IP headers. Redact raw customer data/tokens from logs. Expose export/delete controls and document retention, backups and third-party geocoding; deletion and backup expiry have defined semantics.

Provide an explicit deployment mode, proposed `FILLRATE_MODE=hosted|local`. Hosted mode requires auth configuration (server secret, canonical HTTPS URL, OAuth credentials) and must fail startup if incomplete; it must never silently fall back to local. Local mode is single-user, account-free, creates no auth users/sessions, preserves server-side local SQLite, and requires no OAuth secrets. Default developer/local Compose instructions bind only to loopback; public hosted deployment sets hosted mode explicitly. Disabling account auth never disables internal worker authentication, validation or resource bounds.

Local distribution target: supported Bun and npm commands with Node 24 and Python 3.13/uv, plus the published multi-architecture Docker image/Compose. Bun with `bun.lock` is canonical. npm uses the committed `package-lock.json`, whose direct dependencies `scripts/npm-lock.mjs` keeps identical to `bun.lock`. The native npm workflow (install, lint, typecheck, tests with the real worker, contract and migration generation, build, dev and production start with the worker in local mode) was verified on Node 22 in a cloud dev container on 2026-10-05; CI's `npm` job checks install, typecheck, Vitest with the real worker and build on Node 24. macOS native is unverified and native Windows is unsupported (`docs/local.md`). No browser-local storage overhaul or browser Python solver is required. The same fulfillment engine and data contracts serve both modes.

Sources: https://better-auth.com/docs/adapters/drizzle and https://better-auth.com/docs/concepts/rate-limit. Implementation status and operation: `docs/hosted-operations.md`.

### Container image and CI

Publish one image, `ghcr.io/timblazing/fillrate`, containing both the web app and the optimizer:

- Multi-stage Dockerfile at the repository root. One stage installs dependencies with Bun and builds the Next.js standalone output (`output: "standalone"`), compiling `better-sqlite3` for the target platform. Another creates a Python 3.13 virtual environment with uv from the locked, pinned PyVRP, OR-Tools, scikit-learn, and FastAPI dependencies. At M5, an additional build step fetches and verifies the pinned ZCTA Gazetteer lookup. The runtime stage is based on `node:24-slim` plus a matching Python 3.13 runtime and copies the built application and Python environment, plus the lookup when implemented. Bun is not needed at runtime.
- The runtime starts the Next.js server and the FastAPI service/worker supervisor under a small init such as `tini` with a supervisor script. Run migrations before either server accepts work. If either process exits unexpectedly, the container exits so the restart policy recovers it.
- Run as a non-root user, expose only the web port (3000), declare `/data` as a volume, and add a `HEALTHCHECK` against the web health route. That route also reports worker connection and database status.
- The Python service listens only on localhost inside the container.

GitHub Actions workflow `.github/workflows/ci.yml` runs on relevant code/configuration changes in pull requests and pushes to `main`, on manual dispatch, and as a reusable prerequisite for image releases. Documentation/design-only changes skip automatic CI:

- `bun install --frozen-lockfile`, lint, typecheck, and Vitest (including the real-file SQLite claim-race test).
- `uv sync --locked` and pytest (capability fixtures, allocation, and validation).
- Contract round-trip fixtures, and local headless `agent-browser` smoke flows against a production build (`bun run test:browser`), with isolated temporary data and desktop/iPhone 16 checks.

GitHub Actions workflow `.github/workflows/image.yml`:

- Triggers: release tags matching `v*` and explicit `workflow_dispatch`. Do not publish an image after every successful CI run. The release calls reusable CI before native builds/smokes and publication.
- Uses native amd64/arm64 runners, `docker/setup-buildx-action`, `docker/login-action` with `GITHUB_TOKEN` (permissions `contents: read`, `packages: write`), and `docker/build-push-action` with GitHub Actions layer cache.
- Tags: `latest` for the default branch, `sha-<short>`, and semver tags (`1.2.3`, `1.2`) for `v*` tags. Add OCI labels for source, revision, and version.
- Platforms: `linux/amd64` and `linux/arm64`. Both are required (Ubuntu VPS and 64-bit Raspberry Pi). Verify locked wheels for both target architectures in CI; a missing wheel is a release blocker to resolve explicitly, not permission to drop arm64. Historical wheel discovery is not a successful container build.
- Check out the exact tag/manual-dispatch commit; reusable CI must pass for that same revision. Build and test an immutable candidate digest, then promote that same digest, avoiding rebuilds between smoke and publication.
- A smoke job runs the built image with a temporary volume, waits for health, and completes one bundled lesson solve through the public API before the image is pushed as `latest`. The M1 smoke solve is the small synthetic pipeline; M3 adds an imported scenario.

Reference `deploy/compose.yaml`:

```yaml
services:
  fillrate:
    image: ghcr.io/timblazing/fillrate:latest
    restart: unless-stopped
    ports: ["${BIND_ADDR:-127.0.0.1}:3000:3000"]   # set BIND_ADDR to the host's Tailscale IP
    volumes: ["./data:/data"]
    env_file: [{ path: .env, required: false }]
  valhalla:                              # enabled with `docker compose --profile valhalla up -d`
    image: ghcr.io/valhalla/valhalla-scripted:3.9.0@sha256:89daaf61…  # pinned multi-arch index
    profiles: ["valhalla"]
    restart: unless-stopped
    volumes: ["${VALHALLA_DATA:-./valhalla-data}:/custom_files"] # extracts and config from deploy/valhalla/prepare.sh; tiles built on first start
```

When the `valhalla` profile is used, add the lines printed by `deploy/valhalla/prepare.sh env` (including `VALHALLA_URL=http://valhalla:8002`) to `.env`. The Valhalla service publishes no host port. The pinned 3.9.0 index has linux/amd64 and linux/arm64 variants (checked 2026-10-05; the arm64 image ran on Apple silicon, see `docs/valhalla.md`).

The repository and GHCR image are public, so servers pull without a registry login. Real delivery data, customer addresses, and derived matrices never go into the repository, test fixtures, lesson data, or the image. Lessons use synthetic or public data. Real data exists only in the deployment's `/data` volume and in user-initiated exports.

The reference hostname is `fillrate.blasingame.dev`, with public HTTPS at Caddy and a private backend connection to the application host. The public proxy must expose only intended browser routes; internal worker/FastAPI endpoints and the database remain unreachable from the internet. Until the hosted account, isolation and abuse-limit work below is implemented, the public deployment remains limited to protected operator workflows and bounded synthetic demonstrations. Before public scenario writes, imports, solver submissions, or real customer data are enabled, implement and test identity and tenant isolation (or an equivalent explicit policy), request-size and run quotas, rate limits, and abuse monitoring. Do not assume a private Tailscale backend protects a public Caddy listener. Native development binds to localhost. Next.js must honor `X-Forwarded-*` headers from the proxy only for URL generation; access decisions never depend on them.

Log job/run IDs, attempts, durations, and error codes. Redact tokens and avoid logging full customer addresses. Health/status views report queue length, worker connection, solver versions, database availability, and road provider configuration. Explicit cleanup can remove old artifacts while preserving referenced saved runs. Migration procedure, backups, and restart recovery are documented.

## 15. Implementation sequence

Milestone numbers remain stable for historical evidence and `/dev`. M2 records accepted design intent; M8 now includes a required dashboard integration/performance pass. Do not reopen completed engine work or equate gallery acceptance with product completion. Execute the remaining work in [completion-plan.md](completion-plan.md).

| Milestone | Deliverable | Exit evidence |
| --- | --- | --- |
| **M1 — Thin durable fulfillment slice** | Preserve the completed foundation/spike. Add minimal Drizzle schema/contracts and a single leased worker task. Run a small bundled scenario through allocation, aggregation, k-means/repair, real PyVRP, validation, and a persisted map/table summary. Integrate §8b and graph preflight. Basic JSON/CSV export, CI and container delivery. | A real synthetic run survives refresh, cancels/restarts safely, reconciles quantities, and exports a validated result. Race/stale-completion tests use a real SQLite file. Both image architectures pass a smoke run. |
| **M2 — Accepted design** | Apply the recorded review answers (see "M2 scope" below): wording, fill thresholds, revenue-first results, stock and coordinate display, blocking preflight, shipment sheet, sweep emphasis. Update Blocks, lab components and the real `/runs/<id>` page; run a short second review round. Design-file maintenance is outside completion scope; production dashboard integration is tracked under M8. | Round-one answers recorded; round-two acceptance recorded; `/runs/<id>` uses the accepted composition with real M1 data; map/table/keyboard/narrow-layout review. Existing mocks remain visibly development-only. |
| **M3 — Operational core** | CSV preview/commit, scenario editing/versioning, full pipeline screens, settings, lineage and unplanned reasons. Per-cluster scheduling and deterministic stage reuse. Cost objective (§8b) and blocking preflight checks (M2 scope). | Imported coordinates → saved run → validated truck/cluster results → branch/export, using real Python outputs. 2,000-order benchmark with measured stage timings. |
| **M4 — Trustworthy experiments / first release** | k explorer, bounded sweeps, comparison signatures/Pareto, ranked Best option / 2nd best / 3rd (§10), partition lower bounds, eligible no-clustering baseline, H3 map/baseline, flagship lesson. | Repeated-seed experiments are independent; cache invalidation and comparison fixtures pass. Exports contain replayable small pipeline inputs/artifacts/script. Target-hardware and recovery checks from M8 are release gates here. Hosted Better Auth login, an approved owner sign-in on the released image, automated cross-user isolation tests, per-user ownership and enforced compute quotas are release gates for personal real-data use. |
| **M5 — Allocation and import depth** | Additional greedy strategies, CP-SAT, whole-order allocation, Census/ZCTA, JSON/GeoJSON, data review. | Strategy/stock reconciliation, provenance, exact small allocation oracle tests, and source-independent reproduction. |
| **M6 — Roads and advanced routing** | Valhalla/imported matrices first; then supported fleet/window/depot/group/shipment/reload features in small capability-gated increments. Manual evaluator and verified warm starts. Optional working Labs surfaces. | Directed-matrix, synthetic-terminal, provider-limit and independent-validator fixtures for each exposed feature. |
| **M7 — Learning and export depth** | Remaining verified lessons, timeline/playback, complete Python export coverage for implemented adapters. | Each lesson runs and each advertised export reproduces its documented semantics. |
| **M8 — Verification and handoff** | Complete the dashboard integration and performance specification, then consolidate browser, performance, container, recovery, public-ingress and access-control, backup/restore and native-development checks. | All required frontend and launch gates in completion-plan.md have evidence; reproducible handoff includes measured hardware/timings and explicit limitations. Checks run throughout implementation. |

Keep the minimal lease/token/attempt protections in M1: a one-worker deployment can still crash, restart, or send stale completion. Defer a general DAG scheduler, elaborate progress streaming, all advanced schema variants, and comprehensive lesson exports. Do not require a full orchestration framework before the first business pipeline.

Every milestone must execute real behavior. A gallery may use labeled fixtures; the product must not use fake solver results, random routes, placeholder settings, or toast-only buttons as substitutes for persistence and execution.

### M2 scope: design-review outcomes

Source: the primary user's answers in the in-app review (`/dev/review`, submitted September 30, 2026; export `fillrate-design-review-2026-09-30.json`, question ids in `apps/web/src/app/dev/review/questions.ts` as of commit `593f177`; the review pages were removed after round one). Unanswered: `compare.star`, `data.orders`, `data.inventory`, `overall.fix`. `results.flow` was "mostly, with changes" but no changes were given. Nothing below is inferred for those; they go to round two.

**What M2 builds.** M2 changes presentation and records policy; it adds no new pipeline stage. Apply every item below to (a) the gallery Blocks and `src/components/lab` components, and (b) the real `/runs/<id>` page, which already shows M1 pipeline output. Workbench editing, imports and sweeps remain M3/M4 screens; M2 only fixes how they look in the Blocks. Keep every gallery fixture labeled development-only.

 1. **Wording (user-facing labels only).**
    - A group of nearby stops is a **Cluster** (unchanged).
    - One truck with its stops and order lines is a **Shipment**: "Shipment 3", "12 shipments", Loads tab → **Shipments**. The vehicle keeps its name where the vehicle is meant: "trailer fill", "53 ft trailer". Metric labels become "Shipments" (count) and "Trailer fill".
    - Pieces that don't go out are **Unshipped** (unchanged).
    - Code, contracts, database columns and exports keep `load`/`route`/`truck`/`unplanned`; the mapping lives in one place (a copy module in `src/lib`, not scattered strings). Exports use the internal names with a header note giving the UI label.
    - PyVRP's pickup-and-delivery "shipments" (§3, M6) must be labeled **pickup-delivery pairs** in the UI to avoid a clash.
 2. **Map first.** After a run, the default view is the cluster map (`workbench.first`); the summary strip and side panel stay alongside it. No layout change is needed beyond making the map the initial focus/tab at every width.
 3. **Trailer fill.** Fill % becomes the primary per-shipment visual (`workbench.trailer`: "readable, but a plain fill % would do"): a large `FillPercent` with a thin `FillMeter`. The segmented trailer bar (`TrailerFill`) moves to the shipment detail and shipment sheet, not lists or cluster cards.
 4. **Low-fill threshold 80%.** `FILL_LOW = 0.80` in `src/lib/units.ts` (was 0.60). Move `FILL_FULL` to 0.90 so the middle band stays meaningful (a provisional default; confirm in round two). Every legend, "Needs attention" list and band color reads these constants. Record both as run-display settings; they never affect the solver.
 5. **Coordinate provenance only on problems** (`orders.coords`). Hide the badge for file-provided and Census-matched coordinates, and for manual placement. Show it for ZIP-approximate and missing/unresolved. Add a "Show all sources" toggle to the orders table and a "Coordinate problems" filter. Map popups follow the same rule.
 6. **Stock coverage columns** (`orders.stock`): per product show **pieces short**, **fill rate %** (allocated ÷ ordered pieces, N/A when nothing was ordered) and **which orders were shorted** (expandable list or link to the filtered order lines). On-hand vs ordered and dollars short move into a details popover, not the default columns.
 7. **Pipeline stages visible** (`run.stages`). Keep the stage list expanded by default during and after a run; rename the heading from "Pipeline detail" to **Steps**. Collapsing is a remembered per-browser preference.
 8. **Blocking preflight checks** (`run.block`; amended by round two, see "Round-two outcomes" below). Three checks block a run: **addresses with no coordinates**, **stops farther than 500 mi from the depot**, and **a stop larger than one trailer**. ZIP-only placement warns but runs. The Run pipeline Block shows blocked checks as errors that disable Run pipeline, each with its affected lines and resolutions:
    - fix the data (M3 editing);
    - **Exclude these lines and run**: an explicit, recorded exclusion with reason `excluded_by_user`, reconciled like any exclusion (§10);
    - turn the check into a warning in Constraints; that choice is recorded in the run's settings snapshot.
      These checks are policy, not physics. Per §7, a far stop can still be reachable through an intermediate stop, and an oversized stop can be split across shipments. The checks stop the run because the user asked for it, not because the plan is impossible. In M2, add the checks to the preflight contract and the Block. Enforcement at submission lands with M3 imports, because the bundled M1 example deliberately contains all three cases; the example must declare them as warnings so it keeps running and keeps testing those paths.
 9. **Results lead with revenue** (`results.judge`). The metric groups are ordered Revenue → Trailer fill → Tightness. The run summary headline is planned revenue with shipped/allocated/ordered amounts. The iteration table sorts by planned revenue by default. The default Pareto vector (§8a) already contains revenue; leave it unchanged. Keep the flow strip (Orders → Allocated → Stops → Clusters → Shipments → Shipped) as is until round two says what to change.
10. **Unshipped reasons.** All four offered groups occur in his work: no stock, beyond the 500 mi leg limit, did not fit on a truck, bad or missing address data. Keep these four as the top-level groups, mapped from the §10 reason codes (`stock_shortage`; `unreachable_in_partition`/leg; oversize/capacity; excluded input incl. `excluded_by_user`). Other codes (validation failure, budget exhausted) appear in an "Other" group only when present.
11. **Shipment sheet** (`results.load-sheet`). Each shipment gets a printable sheet and CSV with, per stop in visit order: **sequence**, **order numbers**, **linear feet**, **miles from previous stop** (depot for stop 1), and **dollar value**; plus shipment totals (stops, linear feet and fill %, loaded miles, value). Addresses and per-product pieces were not requested: leave them off by default, available as optional columns. Print styles: one shipment per page, black-and-white safe, no map. Implement on `/runs/<id>` (real data) with a Print button and a CSV link using the existing export route.
12. **k explorer confirmed.** Trial-and-error k with seed stability matches his practice. Keep the Block's concepts and wording; add a "Use this k" action that carries k (and seed) into run settings.
13. **Sweep emphasis** (`compare.vary`). He varies **k**, **seed**, **inventory available** and **mileage** (circuity factor or the 500-mile limit). Show those four first in the sweep builder and comparison "changed settings" columns. Order subsets and allocation rule go under "More". Inventory changes stay a changed-assumption cohort (§10), marked as such in the table.
14. **Cost objective UI.** Add **Cost per truck** and **Cost per mile** (dollars) to the Fleet/Constraints inspector design, and an objective selector: Lowest cost (default once rates are set) / Fewest trucks, then miles / Fewest miles with truck penalty. Until both rates exist, show "Using fewest trucks, then miles until truck and mile costs are set." The solver work is M3 (§8b).
15. **500-mile copy.** Everywhere the rule is described (tooltips, Constraints, Block copy, review page), say "no single drive over 500 mi, including depot → first stop." Remove cluster-diameter language from default views. Cluster cards keep "widest pair" as a tightness metric, not a limit. The diameter limit appears only under advanced Constraints as an optional policy, off by default. **Pipeline change in M2:** the M1 pipeline's default cluster-diameter policy becomes disabled (repair, validation and auto-k use it only when enabled). Update fixtures and tests so the bundled example still reconciles, and record the change in `docs/decisions.md`. With diameter off, auto-k only enforces solve size, so the Blocks present **fixed k from the explorer** as the normal path.
16. **Design-file maintenance removed from completion scope (owner, 2026-10-06).** `fillrate.fig` and OpenPencil are historical assets. CSS tokens and the implemented `/dev/components` gallery are the design reference. Dashboard composition and optimization remain required in M8; see [frontend-spec.md](frontend-spec.md).
17. **Round two review.** Run a short second round (restore `/dev/review` from commit `593f177`, or use another channel). Use new question ids; never reuse round-one ids. Show the revised Blocks and ask:
    - accept / change each revised Block;
    - what to change in the flow strip;
    - the ★ label (non-dominated / best trade-off / contender / none);
    - **cost per truck and cost per mile**;
    - whether a stop reachable only through another stop (e.g. 594 mi from the depot via a 396 mi stop) should still block;
    - whether a stop larger than one trailer should block or just split;
    - the 90% "full" band;
    - example order and inventory rows (fake values);
    - "what should we fix first".
      Round-one answers stay stored and exported as-is.

**Round-two outcomes (October 1, 2026).** Source: export `docs/reviews/fillrate-design-review-2026-10-01.json` (question ids `r2.*`); the `/dev/review` pages were removed afterwards.

- Accepted as built: Workbench, Orders & inventory, Run pipeline, Results, k explorer, Iteration comparison, `/runs/<id>` and the shipment sheet. The flow strip stays as is (`r2.results.flow: keep`). The 90% full band is confirmed (`FILL_FULL = 0.90`).
- ★ label: **Best trade-off** (UI copy in `src/lib/copy.ts`; internal name stays non-dominated).
- Cost rates: "N/A" for both. No default rates; trucks-then-miles remains the default objective.
- **Far stops (**`r2.rules.far-via: warn`**).** Item 8's far-from-depot check now blocks only a stop that no chain of allowed drives reaches from the depot through other eligible stops (straight-line × travel circuity, each drive within the leg limit, excluded lines removed). A stop over the limit from the depot but reachable through another stop is the separate, always-warning check `far_via_stop`. Preflight cannot know the final clusters, so the warning says the stop may still be unshipped if its intermediate stop lands in another cluster.
- **Oversize stops (**`r2.rules.oversize: split`**).** `oversize_stop` defaults to **warn**: the stop splits across shipments. Users can still set it to block. An indivisible piece longer than a trailer remains `oversize_piece` (physics, not policy).
- `r2.workbench.change`: "Best option, 2nd best, 3rd" → M4 ranked options (§10).
- Default blocking checks are now two: no coordinates, and stops no route reaches within the leg limit.

**Exit evidence.** Round-one answers and each decision above recorded in `docs/decisions.md`. Revised Blocks and `/runs/<id>` reviewed at desktop and 390 px widths with keyboard-only navigation (map selections have a table equivalent). The shipment sheet prints and exports correctly from a real run. The diameter-policy default change passes optimizer and Vitest suites. Round-two answers recorded, with explicit acceptance of the Blocks (or the requested changes applied and re-accepted). Lint, typecheck, build, pytest and Vitest pass. No design-file update gates completion (owner direction, 2026-10-06). The separate M8 frontend acceptance still applies.

## 16. Acceptance criteria and test plan

### Model correctness

- Native capability fixtures cover every exposed PyVRP feature against the pinned release.
- Independent route validation checks visit coverage, capacities/load transitions, supported windows, depot/reload semantics, shipments, and groups; tests use small constructed instances with known feasible/infeasible cases.
- Allocation, piece-level or whole-order, never exceeds stock for any product/depot. Residual inventory reconciles, and allocated amounts equal allocated pieces × net value per piece. Whole-order mode never partly fills an order.
- The "order date, then value" strategy is deterministic and never gives stock to a newer line while an older line of the same product is short, except through the value tiebreak on the same date.
- Every validated truck's load is at most its capacity (5,300 hundredths of a foot by default); no leg exceeds the maximum leg distance; every cluster's diameter is within the limit; each mandatory visit in a complete plan belongs to exactly one cluster and one truck; excluded and unplanned pieces remain accounted for.
- Oversize stops are split into visits of at most one trailer, and the split visits sum to the original stop.
- k-means results are identical for the same inputs, ordering, seed, pinned versions, numerical platform and thread settings; auto-k and diameter repair are deterministic.
- Stability and seed agreement are invariant to label permutation. ARI and non-singleton peer agreement equal 1 for identical partitions; singleton peer agreement is N/A. Test negative ARI, raw versus repaired assignments, duplicate locations, and deterministic H3 repair against small hand-computed cases.
- Mandatory allocated stops are not silently dropped; routing failures do not report successful fulfillment.
- Optional-client, reload, pickup, and inventory interactions are either validated or explicitly rejected by the selected adapter.
- Heuristic results, CP-SAT status, and PyVRP search outcomes are labeled correctly.
- A 400 + 200 mile chain to a stop 600 miles from the depot is accepted when otherwise feasible; an enabled service radius excludes it explicitly. A partition that removes its bridge is diagnosed as such.
- Missing-edge candidates are rejected despite solver feasibility; physical mileage is recomputed from raw matrices, never the synthetic return or sentinel cost.
- Enumerate small feasible route sets to verify `F = nL + 1` truck precedence and a weighted-mode counterexample. Check safe numeric bounds and the zero-visit case.
- Greedy splitting conserves whole pieces, rejects an oversize indivisible piece, and makes no globally optimal packing claim. Repeated locations use distinct visits but shared matrix nodes.
- Fixed allocation plus complete service has identical planned revenue across k/seeds; excluded demand cannot consume inventory.

### Data and comparisons

- Coordinate provenance and ZIP approximation remain visible after import, correction, save, export, and solve.
- Directed matrices preserve order, asymmetry, units, unreachable edges, and block boundaries; no silent fallback occurs.
- Scaling fixtures reproduce solver costs without overflow; comparison metrics identify incompatible objective/matrix versions.
- Saved runs preserve scenario/settings/matrix snapshots after defaults or scenarios change.
- Cache fixtures vary one dependency at a time (inventory, k, seed, road profile, spatial factor, display units, producer version); only dependent artifacts invalidate. Reused solver output never counts as an independent replicate.
- Comparison fixtures verify ties, strict Pareto domination, metric directions, incompatible cohorts, and exclusion of partial/invalid plans from default ranking.
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
- Learning mode works with bundled data without Census/Valhalla connectivity; an unavailable online basemap shows an explicit empty-background state without disabling tables or bundled geometry. A writable data volume is required for persisted app state.
- All browser tests and visual QA use the local headless `agent-browser` CLI in named sessions. Browser tests cover real scenario creation, save, solve, cancellation, branch, comparison, and export. Visual QA checks 1440×900 desktop and iPhone 16 (393×852) layouts against the accepted design. Automated fixtures use temporary databases and synthetic inputs; live OAuth and deployment evidence are recorded separately.
- Server-only modules (database, provider adapters, env config) are never bundled for the client. Internal worker endpoints reject non-loopback requests and requests without a valid worker token and lease. A public deployment exposes only intended browser routes; public writes and real-data access require isolation and abuse-control tests before launch.
- Time windows round-trip correctly across the scenario timezone, including a daylight-saving transition date and a shift that ends after midnight.

## 17. Deferred extensions

Minimum shipment quantities and per-product utility for partial fulfillment; joint visit-bundling/bin-packing optimization; route-aware allocation repair (returning stock from unloadable lines to other lines); joint allocation-and-routing optimization; optional VROOM or OR-Tools routing comparisons after a concrete need and semantic-compatibility proof; Timefold/ORS integrations; [deck.gl](http://deck.gl) visual layers; MapLibre-Geoman Free drawing tools; validated VRPLIB rich-variant import; organization accounts and sharing beyond the public-access requirements in §14; live traffic; real dispatch integration.

These are extension points, not required dependencies or nonfunctional UI promises. The first release should deliver a correct, explainable fulfillment pipeline (piece-level allocation, clustering, per-cluster loads, iteration comparison) and then deeply cover the pinned open-source PyVRP capabilities.

## 18. Implementation brief (Codex and Claude Code)

Implement this specification as a real full-stack application. Preserve Next.js + Bun tooling + Node runtime + coss ui (Base UI) + Tailwind + mapcn, Valhalla + Turf + H3, SQLite + Drizzle, and Python FastAPI + PyVRP + OR-Tools + scikit-learn. Do not add [maps.black](http://maps.black) or paid enterprise features. Use whatever frontend, coss ui/Base UI, and React/Next.js guidance the current agent has available for UI concepting, component composition, and server/client boundaries.

The build alternates between Codex and Claude Code sessions. To keep context across sessions:

- `AGENTS.md` at the repository root is the canonical agent instruction file. It holds the repository layout, commands, conventions, and a pointer to this spec. `CLAUDE.md` contains only `@AGENTS.md`, so both tools read the same instructions.
- `docs/decisions.md` is an append-only decision log. Each entry records the date, the decision, the reason, and the session tool. It covers exact version pins, the Valhalla coverage, the accepted design direction, and every deviation from or interpretation of this spec.
- `docs/progress.md` holds the milestone checklist from §15, the current state, known gaps or failing tests, and the single next step.
- Every session starts by reading `AGENTS.md`, `docs/progress.md`, `docs/decisions.md`, and the relevant spec sections. Before ending, it updates `docs/progress.md` and `docs/decisions.md` and leaves the tree in a state that passes CI, or records exactly what fails.
- Use an isolated task worktree from latest `origin/main`, scoped commits, and a reviewed PR targeting `main`, as required by `AGENTS.md`. Never overwrite another session’s work. Confirm external writes when the active session instructions require it.
- This spec changes only through a new revision note and version bump; implementation-level choices go in `docs/decisions.md`.

Continue from the merged product. Prioritize the frontend integration and performance pass, then close launch gates in completion-plan.md. Preserve solver pins and validated business rules. Keep image publication, deployment and local checks distinct, and supply reviewable evidence for each completed gate.

## 19. Primary references and verification notes

### Research reconciliation (September 30, 2026)

The attached recommendations predate the current Valhalla/H3 decisions and optimizer capability findings. Adopt the model boundaries, small adapter contracts, stage artifacts, explicit objectives, and comparison identities. Keep existing durability safeguards, but make the first pipeline a small sequential job. Defer Labs navigation and second-solver integrations until they solve an actual need.

| Reference reviewed | Useful lesson for Fillrate | Decision |
| --- | --- | --- |
| [Valhalla web app](https://github.com/valhalla/web-app) | A focused interface for routing options and isochrones | Use as later Travel Lab inspiration; keep current mapcn stack. |
| [H3 Explorer UI](https://github.com/JesusCabreraReveles/h3-explorer-ui) | Inspect resolution, cells, neighbors and exports interactively | Borrow interaction concepts; use existing JS/Python H3 bindings, not its Go service. |
| [Timefold quickstarts](https://github.com/TimefoldAI/timefold-quickstarts) | Small runnable domain examples and explicit constraints | Use as lesson-design inspiration; no Java/Quarkus runtime dependency. |
| [Route-Optimiser](https://github.com/srummanf/Route-Optimiser) | Separate matrix acquisition, stop-order solving, and geometry display | Reinforces travel/solver separation; no OSRM or Leaflet migration. |
| [Last-mile route optimization](https://github.com/manuelbomi/last-mile-route-optimization) | Its assignment MILP and sequenced VRP solve different mathematical problems | Require problem fingerprints; never compare unlike objective values as solver quality. |
| [openrouteservice](https://github.com/GIScience/openrouteservice) | Distinguishes road services from separately hosted VROOM optimization | Keep Valhalla as the single optional road provider; no second GIS backend. |

Additional checks: [PyVRP 0.14.0 Model source](https://github.com/PyVRP/PyVRP/blob/v0.14.0/pyvrp/Model.py) documents finite missing-edge values; local capability fixtures establish Fillrate's actual behavior. [Valhalla Matrix](https://valhalla.github.io/valhalla/api/matrix/) defines row-ordered matrices and null unreachable pairs; [truck costing](https://valhalla.github.io/valhalla/api/route/api-reference/) and [configuration](https://github.com/valhalla/valhalla/blob/master/scripts/valhalla_build_config) must be checked again against the eventual pinned image. [H3 statistics](https://h3geo.org/docs/core-library/restable/) give average cell sizes, not diameter guarantees. [KMeans](https://scikit-learn.org/stable/modules/generated/sklearn.cluster.KMeans.html) and [ARI](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.adjusted_rand_score.html) inform the clustering diagnostics. These sources establish library behavior; the policies and derived objective bound in this spec are Fillrate design decisions.

[VROOM's API](https://github.com/VROOM-Project/vroom/blob/master/docs/API.md) is a future comparison candidate, not an accepted dependency. No new solver is needed to finish the primary workflow.

### Implementation references

- [PyVRP repository](https://github.com/PyVRP/PyVRP) and [stable documentation](https://pyvrp.readthedocs.io/en/stable/): supported open-source and enterprise boundaries. Stable docs identified 0.14.0 during discovery; preserve the lockfile pin and reverify on upgrades.
- [PyVRP v0.14.0 modeling code](https://github.com/PyVRP/PyVRP/blob/v0.14.0/pyvrp/Model.py): modeling adapter baseline.
- [coss ui docs](https://coss.com/ui/docs) and [llms.txt](https://coss.com/ui/llms.txt): UI primitives (Base UI) and their composition patterns.
- [mapcn repository](https://github.com/AnmolSaini16/mapcn) and [basic map docs](https://www.mapcn.dev/docs/basic-map): component setup, theme, routes, and separate basemap terms.
- [Valhalla repository](https://github.com/valhalla/valhalla), [API documentation](https://valhalla.github.io/valhalla/), and [Docker images](https://github.com/valhalla/valhalla/blob/master/docker/README.md): Matrix/Route requests, `truck` costing options, `service_limits`, and tile builds. Match documentation to the pinned image. (The older `nilsnolde/docker-valhalla` image is archived and moved upstream.)
- [routingpy](https://github.com/routingpy/routingpy): Python client for Valhalla matrices, useful in the Python reproduction export.
- [H3](https://h3geo.org/), [h3-js](https://github.com/uber/h3-js), and [h3-py](https://github.com/uber/h3-py): hexagonal cells for the map layer and the H3 clustering baseline.
- [Turf.js](https://github.com/Turfjs/turf): browser geographic operations.
- [OR-Tools](https://github.com/google/or-tools), the [CP-SAT solver guide](https://developers.google.com/optimization/cp/cp_solver), and the [CP-SAT Primer](https://github.com/d-krupke/cpsat-primer): allocation/constraint programming and optional future routing models.
- [scikit-learn KMeans](https://scikit-learn.org/stable/modules/generated/sklearn.cluster.KMeans.html): clustering stage; record the pinned version with each run.
- [Bun Next.js guide](https://bun.sh/guides/ecosystem/nextjs): Bun as package manager/script runner for Next.js (the server itself runs on Node).
- [Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output): container build.
- [Drizzle SQLite guide](https://orm.drizzle.team/docs/get-started-sqlite) and [better-sqlite3](https://github.com/WiseLibs/better-sqlite3): database driver.
- [Census Geocoder API](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html) and [Census Gazetteer files](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html): address geocoding and ZCTA fallback.
- [Geofabrik downloads](https://download.geofabrik.de/north-america/us.html): regional OSM extracts for Valhalla. [SQLite WAL documentation](https://www.sqlite.org/wal.html): concurrency, checkpointing, and backup behavior.
- [Docker build-push-action](https://github.com/docker/build-push-action) and [GitHub Container Registry docs](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry): image publishing workflow.

Defaults, architecture, limits, settings, and implementation stages in this document are project design decisions, not claims that PyVRP or its companion libraries provide all these workflows out of the box.

## Hosted release scope added in v1.10

M4 first-live-release exit evidence additionally requires Better Auth hosted accounts, automated cross-user isolation tests, enforced compute limits and a real owner sign-in on the deployed image. A second live GitHub account is not required by the owner for this release. M8 continues broader browser coverage and auth-free Bun/npm/Docker local startup. `docs/progress.md` holds the implementation breakdown and dependencies; `docs/release-verification.md` records the evidence and its limits.
