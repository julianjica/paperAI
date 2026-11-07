// Copies pdf.js's worker next to the app's static files so the viewer can
// load it from /pdf.worker.min.mjs without bundler-specific URL tricks.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pkg = path.dirname(require.resolve("pdfjs-dist/package.json"));
const src = path.join(pkg, "build", "pdf.worker.min.mjs");
const dest = path.join(process.cwd(), "public", "pdf.worker.min.mjs");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log(`copied ${path.relative(process.cwd(), src)} -> public/pdf.worker.min.mjs`);
