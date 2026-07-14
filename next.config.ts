import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
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
