import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	output: "standalone",
	outputFileTracingExcludes: { "*": ["**/data/**/*", "examples/**/*", ".env*"] },
	serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
};

export default nextConfig;
