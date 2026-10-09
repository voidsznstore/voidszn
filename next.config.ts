import type { NextConfig } from "next";

// Product photos are served from the store's image bucket.
const imageHost = new URL(process.env.R2_PUBLIC_URL || "https://img.voidszn.com");

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  images: {
    // Only true when the bucket address points at this machine, as it does in tests.
    dangerouslyAllowLocalIP: ["127.0.0.1", "localhost"].includes(imageHost.hostname),
    remotePatterns: [
      {
        protocol: imageHost.protocol === "http:" ? "http" : "https",
        hostname: imageHost.hostname,
        port: imageHost.port,
      },
    ],
  },
  async headers() {
    return [
      {
        // The logo and font that emails load. Mail apps fetch them from other
        // origins, and a font is refused without this.
        source: "/email/:file*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: "public, max-age=604800" },
        ],
      },
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
