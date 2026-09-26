import { app, BrowserWindow, ipcMain, dialog, shell, session } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DentivaApp, defaultDataDir } from "../core/app.ts";
import { toUserError, isAppError } from "../core/errors.ts";
import { APP_NAME } from "../shared/constants.ts";
import { createApiServer, invokeIpc } from "../server/http.ts";

app.commandLine.appendSwitch("js-flags", "--experimental-sqlite");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let dentiva: DentivaApp | null = null;
const tokens = new Map<string, string>(); // webContents id -> token not used; renderer stores token

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: APP_NAME,
    backgroundColor: "#F4F1EA",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  const devUrl = process.env.DENTIVA_RENDERER_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = devUrl && url.startsWith(devUrl);
    const file = url.startsWith("file:");
    if (!allowed && !file) event.preventDefault();
  });
}

function boot(): void {
  const dataDir = process.env.DENTIVA_DATA_DIR || defaultDataDir();
  dentiva = new DentivaApp(dataDir);
  const port = Number(process.env.DENTIVA_API_PORT || 4780);
  createApiServer(dentiva, "127.0.0.1", port);
  registerIpc();
}

function wrap<T>(fn: () => T | Promise<T>): Promise<T> {
  return Promise.resolve()
    .then(fn)
    .catch((err: unknown) => {
      const u = toUserError(err);
      const error = Object.assign(new Error(u.message), {
        code: u.code,
        details: isAppError(err) ? err.details : undefined,
      });
      throw error;
    });
}

function registerIpc(): void {
  const getApp = () => {
    if (!dentiva) throw new Error("Application is not ready.");
    return dentiva;
  };

  ipcMain.handle("meta:setup", () => wrap(() => ({ needsSetup: getApp().auth.needsSetup(), info: getApp().info() })));
  ipcMain.handle("auth:bootstrap", (_e, body) => wrap(() => getApp().auth.bootstrap(body)));
  ipcMain.handle("auth:login", (_e, body) => wrap(() => getApp().auth.login(body)));
  ipcMain.handle("auth:logout", (_e, token: string) =>
    wrap(() => {
      getApp().auth.logout(token);
      return { ok: true };
    }),
  );
  ipcMain.handle("auth:session", (_e, token: string) => wrap(() => getApp().auth.touch(token).session));
  ipcMain.handle("auth:lock", (_e, token: string) => wrap(() => getApp().auth.lock(token)));
  ipcMain.handle("auth:unlock", (_e, token: string, password: string) => wrap(() => getApp().auth.unlock(token, password)));

  ipcMain.handle("api:call", (_e, token: string, route: string, payload: unknown) =>
    wrap(() => invokeIpc(getApp(), token, route, payload)),
  );

  ipcMain.handle("dialog:openBackup", async () => {
    const result = await dialog.showOpenDialog({
      title: "Select Dentiva Pro backup",
      filters: [{ name: "Dentiva backup", extensions: ["dvbak", "zip"] }],
      properties: ["openFile"],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("dialog:savePdf", async (_e, defaultName: string) => {
    const result = await dialog.showSaveDialog({
      title: "Save PDF",
      defaultPath: defaultName,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    return result.canceled ? null : result.filePath ?? null;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => {
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      cb({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*; script-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'",
          ],
        },
      });
    });
    boot();
    createWindow();
  });
}

app.on("window-all-closed", () => {
  dentiva?.close();
  app.quit();
});

void tokens;
