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
