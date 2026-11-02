import type { NextConfig } from "next";

// Cache Components is intentionally off: every dashboard route is
// authenticated and workspace-scoped, so pages render per request.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Development only. The dev server serves its client assets only to localhost
  // and hosts listed here. This machine is also opened at its link-local address;
  // without this entry pages render but React never loads, so nothing on them is
  // interactive (e.g. choosing an import file does nothing). Ignored in production.
  allowedDevOrigins: ["169.254.83.107"],
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
