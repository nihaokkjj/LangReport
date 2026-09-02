import { config } from "dotenv";
import { resolve } from "node:path";
import type { NextConfig } from "next";

config({ path: resolve(process.cwd(), "../../.env") });

const nextConfig: NextConfig = {};

export default nextConfig;
