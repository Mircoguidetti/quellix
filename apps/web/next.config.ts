import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  async rewrites() {
    // The public marketing pages are static HTML in public/pages (see its README note in the PR history).
    return {
      beforeFiles: [
        { source: "/", destination: "/pages/landing.html" },
        { source: "/product", destination: "/pages/product.html" },
        { source: "/drones", destination: "/pages/drones.html" },
        { source: "/security", destination: "/pages/security.html" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async redirects() {
    // The old "Developers" page became the docs (issue #56).
    return [{ source: "/developers", destination: "/docs", permanent: true }];
  },
  turbopack: {
    rules: {
      // Tailwind for global stylesheets. CSS Modules keep Next's own module handling (scoped class
      // names), so they are left out of this rule.
      "*.css": {
        condition: { not: { path: /\.module\.css$/ } },
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
