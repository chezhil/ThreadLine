import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // The dev-only "N" badge sat on top of the sidebar's Mill Clock.
  devIndicators: false,
  // pg and @prisma/client are external by default; keep the adapter beside them.
  serverExternalPackages: ["@prisma/adapter-pg"],
  // Module 3 shipped at /qc, /rolls and /defects; the integrated app serves
  // them under /quality. Keep old links and printed roll labels working.
  async redirects() {
    return [
      { source: "/qc", destination: "/quality/qc", permanent: false },
      { source: "/defects", destination: "/quality/defects", permanent: false },
      { source: "/rolls", destination: "/quality/rolls", permanent: false },
      { source: "/rolls/:id", destination: "/quality/rolls/:id", permanent: false },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
