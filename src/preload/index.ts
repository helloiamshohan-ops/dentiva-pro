import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("dentivaDesktop", {
  invoke: (channel: string, ...args: unknown[]) => {
    const allowed = new Set([
      "meta:setup",
      "auth:bootstrap",
      "auth:login",
      "auth:logout",
      "auth:session",
      "auth:lock",
      "auth:unlock",
      "api:call",
      "dialog:openBackup",
      "dialog:savePdf",
    ]);
    if (!allowed.has(channel)) return Promise.reject(new Error("Unknown channel"));
    return ipcRenderer.invoke(channel, ...args);
  },
});
