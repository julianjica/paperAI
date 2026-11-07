const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("researchai", {
	pickFolder: () => ipcRenderer.invoke("pick-folder"),
});
