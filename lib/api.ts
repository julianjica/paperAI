/** Thin fetch helpers for the workspace. Every call throws on a non-2xx with the server's message. */
async function call<T>(url: string, init?: RequestInit): Promise<T> {
	const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
	const body = (await res.json().catch(() => ({}))) as T & { error?: string };
	if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
	return body;
}

export const api = {
	get: <T>(url: string) => call<T>(url),
	post: <T>(url: string, body?: unknown) => call<T>(url, { method: "POST", body: JSON.stringify(body ?? {}) }),
	put: <T>(url: string, body?: unknown) => call<T>(url, { method: "PUT", body: JSON.stringify(body ?? {}) }),
	patch: <T>(url: string, body?: unknown) => call<T>(url, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
	del: <T>(url: string) => call<T>(url, { method: "DELETE" }),
};
