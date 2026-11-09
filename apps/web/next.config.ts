import type { NextConfig } from "next";

const config: NextConfig = {
  // PGlite/postgres are server-only; keep them out of the client bundle analysis.
  serverExternalPackages: ["postgres"],
};
export default config;
