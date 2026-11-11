import path from "node:path";

/** Leaf facts: where the app keeps its own state. RA_DATA_DIR overrides (tests, Electron userData). */
export const DATA_DIR = process.env.RA_DATA_DIR ? path.resolve(process.env.RA_DATA_DIR) : path.join(process.cwd(), "data");
/**
 * The legacy per-project state folder, once created INSIDE the paper folder.
 * State now lives under DATA_DIR/projects/<id>; a folder by this name is
 * migrated there and removed the first time its project is opened.
 */
export const SIDECAR = ".researchai";
