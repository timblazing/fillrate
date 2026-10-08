import { join } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
