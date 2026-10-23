import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // lib/model.ts reads public/model.json with fs; tell the file tracer so the deployed functions include it.
  outputFileTracingIncludes: {
    "/": ["./public/model.json"],
    "/api/stuck": ["./public/model.json"],
    "/learn": ["./public/model.json", "./public/model_history.json"],
    "/stats": ["./public/model.json"],
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
