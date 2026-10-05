# Fillrate

Fillrate is an open source project for exploring order fulfillment and truckload planning. The goal is to allocate limited inventory to open orders, group delivery stops, build 53-foot trailer loads, and compare plans by truck fill, geographic tightness, and planned revenue.

The project is under active development. The fulfillment pipeline, imports, allocation experiments, validated results and replay exports work through a durable Python worker. The hosted app uses request-only accounts. Live road matrices and advanced routing remain on the roadmap.

To run it yourself without an account (Bun, npm or Docker Compose), see [local use](docs/local.md). [The handoff](docs/handoff.md) covers setup, verification, measured timings and current limitations.

See the [technical specification](docs/fillrate-technical-spec.md) for the product plan, [progress](docs/progress.md) for remaining work and verification, and [decisions](docs/decisions.md) for the project record. These repository files are the source of truth and power `/dev`.
