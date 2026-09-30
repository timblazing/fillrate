import { join } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image; trace from the repo root so workspace packages are included.
  output: "standalone",
  outputFileTracingRoot: join(import.meta.dirname, "../.."),
};

export default nextConfig;
