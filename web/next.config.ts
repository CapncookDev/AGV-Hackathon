import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/AGV-Hackathon",
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
