import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "researchAI", description: "Agents that rewrite parts of your LaTeX paper." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				{/* Optional local palette (data/theme.css); see app/api/theme.css/route.ts. */}
				{/* eslint-disable-next-line @next/next/no-css-tags */}
				<link rel="stylesheet" href="/api/theme.css" />
			</head>
			<body className="h-full overflow-hidden">{children}</body>
		</html>
	);
}
