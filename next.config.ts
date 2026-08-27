import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    // Block 07: enforce TS strict mode at build time — surface type errors
    // instead of silently letting them through to production runtime.
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  allowedDevOrigins: [
    // Preview panel via space-z.ai gateway (wildcard for subdomains)
    "*.space-z.ai",
    "localhost",
    "127.0.0.1",
  ],
};

export default nextConfig;
