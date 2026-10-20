import type { NextConfig } from "next";

// FILLRATE_STATIC=1 builds the public site (landing, privacy and the sample playground) as a static export in `out/`.
// Only `*.static.tsx` route files are part of it; the full app builds every route. Its route
// types omit the full app's routes, so it skips type checking; `bun run typecheck` covers the full app.
const staticSite = process.env.FILLRATE_STATIC === "1"

const nextConfig: NextConfig = staticSite ? { output: "export", pageExtensions: ["static.tsx"], typescript: { ignoreBuildErrors: true } } : {
  pageExtensions: ["static.tsx", "tsx", "ts"],
};

export default nextConfig;
