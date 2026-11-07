/**
 * Tab-state favicons, drawn as inline SVG data URLs so they need no files:
 * idle (the mark), working (a pulsing dot, animated by swapping frames),
 * done (a check that stays until the user returns to the tab).
 */
type State = "idle" | "working" | "done";

const svg = (body: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${body}</svg>`)}`;
const PAPER = `<rect x="6" y="3" width="20" height="26" rx="3" fill="#f4f4f2" stroke="#1d1d1b" stroke-width="2"/><path d="M11 11h10M11 16h10M11 21h6" stroke="#1d1d1b" stroke-width="2" stroke-linecap="round"/>`;

const FRAMES = {
	idle: [svg(PAPER)],
	working: [0.35, 0.6, 0.85, 1, 0.85, 0.6].map((o) => svg(`${PAPER}<circle cx="25" cy="25" r="7" fill="#1f7a5a" opacity="${o}"/><circle cx="25" cy="25" r="7" fill="none" stroke="#f4f4f2" stroke-width="2"/>`)),
	done: [svg(`${PAPER}<circle cx="25" cy="25" r="8" fill="#1f7a5a" stroke="#f4f4f2" stroke-width="2"/><path d="M21 25l3 3 5-6" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`)],
};

let link: HTMLLinkElement | null = null;
let timer: ReturnType<typeof setInterval> | undefined;

function setHref(href: string) {
	if (!link) {
		link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
		if (!link) {
			link = document.createElement("link");
			link.rel = "icon";
			document.head.appendChild(link);
		}
	}
	link.type = "image/svg+xml";
	link.href = href;
}

export function setFavicon(state: State) {
	if (typeof document === "undefined") return;
	if (timer) clearInterval(timer);
	timer = undefined;
	const frames = FRAMES[state];
	setHref(frames[0]);
	if (frames.length > 1) {
		let i = 0;
		timer = setInterval(() => {
			i = (i + 1) % frames.length;
			setHref(frames[i]);
		}, 350);
	}
}
