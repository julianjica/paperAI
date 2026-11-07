import { execFile } from "node:child_process";

/**
 * Open the OS's native folder dialog on the machine the server runs on and
 * return the chosen path (null when cancelled). The app is single-user and
 * local, so the dialog appears on the user's own screen.
 */
export function pickFolder(): Promise<string | null> {
	return new Promise((resolve) => {
		const done = (error: Error | null, stdout: string) => {
			if (error) return resolve(null); // cancelled (osascript exits 1 on "User canceled")
			const out = stdout.trim();
			resolve(out ? out.replace(/\/$/, "") : null);
		};
		if (process.platform === "darwin") {
			execFile("osascript", ["-e", 'tell application "System Events" to activate', "-e", 'POSIX path of (choose folder with prompt "Open a paper folder")'], done);
		} else if (process.platform === "win32") {
			execFile("powershell", ["-NoProfile", "-Command", "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Open a paper folder'; if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }"], done);
		} else {
			execFile("zenity", ["--file-selection", "--directory", "--title=Open a paper folder"], done);
		}
	});
}
