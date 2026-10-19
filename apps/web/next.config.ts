import { join } from "node:path";
import type { NextConfig } from "next";

// FILLRATE_STATIC=1 builds the public site (landing, privacy and the sample playground) as a static export in `out/`.
// Only `*.static.tsx` route files are part of it; the full app (and the Docker image) builds every route. Its route
// types omit the full app's routes, so it skips type checking; `bun run typecheck` covers the full app.
const staticSite = process.env.FILLRATE_STATIC === "1"

const nextConfig: NextConfig = staticSite ? { output: "export", pageExtensions: ["static.tsx"], typescript: { ignoreBuildErrors: true } } : {
  pageExtensions: ["static.tsx", "tsx", "ts"],
  // Self-contained server for the Docker image; trace from the repo root so workspace packages are included.
  output: "standalone",
  outputFileTracingRoot: join(import.meta.dirname, "../.."),
  // Replay assets are loaded from a deployment path. Keep their trace bounded to the pinned source.
  outputFileTracingIncludes: {
    "/api/v1/runs/*/export": [
      "../../services/optimizer/pyproject.toml",
      "../../services/optimizer/uv.lock",
      "../../services/optimizer/.python-version",
      "../../services/optimizer/src/fillrate_optimizer/*.py",
    ],
  },
  outputFileTracingExcludes: {
    "/api/v1/runs/*/export": [
      "../../services/optimizer/tests/**/*",
      "../../services/optimizer/**/__pycache__/**/*",
      "../../services/optimizer/.venv/**/*",
    ],
  },
};

export default nextConfig;
