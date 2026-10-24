import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // No same-origin /backend proxy.
  // The frontend talks to the Render backend directly over HTTPS using
  // NEXT_PUBLIC_API_URL, so no rewrite can silently point at localhost.
};

export default nextConfig;