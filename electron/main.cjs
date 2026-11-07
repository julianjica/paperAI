/**
 * researchAI — the Electron shell.
 *
 * A thin launcher: in dev (RA_DEV_URL set) the window points at the running
 * `next dev` server. Otherwise it spawns the standalone Next server from
 * `next build` on 127.0.0.1 with the app's data dir under userData.
 * All logic lives in the Next server; this file only adds a native folder
 * picker over IPC (preload.cjs → window.researchai.pickFolder).
 */
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

app.setName("researchAI");

function freePort() {
	return new Promise((resolve, reject) => {
		const srv = net.createServer();
		srv.listen(0, "127.0.0.1", () => {
			const { port } = srv.address();
			srv.close(() => resolve(port));
		});
		srv.on("error", reject);
	});
}

function waitFor(url, tries = 100) {
	return new Promise((resolve, reject) => {
		const attempt = (n) => {
			http.get(url, (res) => {
				res.resume();
				resolve();
			}).on("error", () => (n > 0 ? setTimeout(() => attempt(n - 1), 200) : reject(new Error(`Server did not start: ${url}`))));
		};
		attempt(tries);
	});
}

let child;
async function startServer() {
	if (process.env.RA_DEV_URL) return process.env.RA_DEV_URL;
	const entry = path.join(process.resourcesPath, "server", "standalone", "server.js");
	const fallback = path.join(__dirname, "..", ".next", "standalone", "server.js");
	const script = fs.existsSync(entry) ? entry : fallback;
	if (!fs.existsSync(script)) throw new Error("No built server. Run `npm run build` (or use `npm run desktop:dev`).");
	const port = await freePort();
	child = spawn(process.execPath, [script], {
		env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT: String(port), HOSTNAME: "127.0.0.1", RA_DATA_DIR: path.join(app.getPath("userData"), "data"), PATH: `${process.env.PATH || ""}:/Library/TeX/texbin:/opt/homebrew/bin:/usr/local/bin:${path.join(require("node:os").homedir(), ".local", "bin")}` },
		cwd: path.dirname(script),
		stdio: "inherit",
	});
	const url = `http://127.0.0.1:${port}`;
	await waitFor(url);
	return url;
}

async function createWindow() {
	const url = await startServer();
	const win = new BrowserWindow({
		width: 1440,
		height: 900,
		minWidth: 900,
		title: "researchAI",
		webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false },
	});
	win.webContents.setWindowOpenHandler(({ url: target }) => {
		if (!target.startsWith(url)) void shell.openExternal(target);
		return { action: "deny" };
	});
	await win.loadURL(url);
}

ipcMain.handle("pick-folder", async () => {
	const r = await dialog.showOpenDialog({ properties: ["openDirectory"], title: "Open a paper folder" });
	return r.canceled ? null : r.filePaths[0];
});

app.whenReady().then(() => {
	createWindow().catch((error) => {
		dialog.showErrorBox("researchAI", error.message);
		app.quit();
	});
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) void createWindow();
	});
});
app.on("window-all-closed", () => app.quit());
app.on("quit", () => child?.kill());
