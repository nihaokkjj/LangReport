import { config } from "dotenv";
import { resolve } from "node:path";
import type { NextConfig } from "next";

config({ path: resolve(process.cwd(), "../../.env") });

const apiOrigin = (process.env.API_PROXY_ORIGIN ?? "http://localhost:4000").replace(/\/$/, "");
const distDir = process.env.LANGREPORT_NEXT_DIST_DIR ?? ".next";

const nextConfig: NextConfig = {
  distDir,
  async rewrites() {
    return [
      {
        source: "/api-console/openapi.json",
        destination: `${apiOrigin}/openapi.json`
      },
      {
        source: "/api/health",
        destination: `${apiOrigin}/health`
      },
      {
        source: "/api/:path*",
        destination: `${apiOrigin}/api/:path*`
      }
    ];
  }
};

export default nextConfig;
