export function cn(...parts: (string | false | null | undefined)[]): string {
	return parts.filter(Boolean).join(" ");
}

export function timeAgo(ts: number): string {
	const s = Math.max(0, (Date.now() - ts) / 1000);
	if (s < 60) return "just now";
	if (s < 3600) return `${Math.floor(s / 60)} min ago`;
	if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
	return `${Math.floor(s / 86400)} d ago`;
}
