import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "researchAI", description: "Agents that rewrite parts of your LaTeX paper." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body className="h-full overflow-hidden">{children}</body>
		</html>
	);
}
