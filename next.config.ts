import type { NextConfig } from "next";
import { execSync } from "node:child_process";

function getCommitSha(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  }
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "dev";
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_COMMIT: getCommitSha(),
    NEXT_PUBLIC_APP_BUILD_DATE: new Date().toISOString(),
  },
};

export default nextConfig;
