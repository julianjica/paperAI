import path from "node:path";

/** Leaf facts: where the app keeps its own state. RA_DATA_DIR overrides (tests, Electron userData). */
export const DATA_DIR = process.env.RA_DATA_DIR ? path.resolve(process.env.RA_DATA_DIR) : path.join(process.cwd(), "data");
/** The per-project sidecar folder name, created inside the paper folder. */
export const SIDECAR = ".researchai";
