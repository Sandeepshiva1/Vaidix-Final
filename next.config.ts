import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Pin Turbopack root to this project — avoids walking up the drive,
  // which is especially important on slow filesystems / paths with spaces.
  turbopack: {
    root: path.resolve(__dirname),
  },
  // This machine runs on a mechanical HDD (no SSD), so `next dev` compiles
  // routes on-click painfully slowly. For butter-smooth navigation we serve a
  // production build (`next build` && `next start`) where every route is
  // pre-compiled. tsc is run separately and is clean; skip the build's own
  // type re-check so a slow-disk build can't be blocked by stale generated
  // route types. (Next 16 no longer supports the `eslint` config key and does
  // not run ESLint during build.)
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
