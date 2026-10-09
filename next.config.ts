import type { NextConfig } from "next";

// Product photos are served from the store's image bucket.
const imageHost = new URL(process.env.R2_PUBLIC_URL || "https://img.voidszn.com");

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  images: {
    remotePatterns: [
      {
        protocol: imageHost.protocol === "http:" ? "http" : "https",
        hostname: imageHost.hostname,
        port: imageHost.port,
      },
    ],
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
