import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allows an isolated local verification server alongside the main workspace.
  distDir: process.env.HERMES_BUILD_DIR ?? ".next",
  poweredByHeader: false,
  serverExternalPackages: ["groq-sdk"],
};

export default nextConfig;
