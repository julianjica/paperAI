/** Parse `synctex edit` output into the first (file, line) hit. */
export function parseSynctexEdit(output: string): { file: string; line: number } | null {
	let file: string | undefined;
	let line: number | undefined;
	for (const raw of output.split(/\r?\n/)) {
		const m = /^(Input|Line):(.*)$/.exec(raw.trim());
		if (!m) continue;
		if (m[1] === "Input" && file === undefined) file = m[2].trim();
		if (m[1] === "Line" && line === undefined) line = Number(m[2].trim());
		if (file !== undefined && line !== undefined) break;
	}
	if (!file || line === undefined || !Number.isFinite(line)) return null;
	return { file, line };
}
