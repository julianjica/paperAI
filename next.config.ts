import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	output: "standalone",
	outputFileTracingExcludes: { "*": ["**/data/**/*", "examples/**/*", ".env*"] },
	serverExternalPackages: ["@anthropic-ai/claude-agent-sdk", "pdfjs-dist"],
	// pdf.js loads its worker with a dynamic import the tracer cannot follow; the standalone build needs the file.
	outputFileTracingIncludes: { "/api/projects/*/attachments": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"] },
};

export default nextConfig;
