import type { SessionInfo } from "../shared/types.ts";

const TOKEN_KEY = "dentiva.token";

declare global {
  interface Window {
    dentivaDesktop?: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    };
  }
}

export class ApiError extends Error {
  code: string;
  details?: unknown;
  constructor(message: string, code: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

function desktopBridge(): Window["dentivaDesktop"] | undefined {
  return typeof window !== "undefined" ? window.dentivaDesktop : undefined;
}

function blobFromIpc(result: { data: string; mime: string }): Blob {
  const binary = atob(result.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: result.mime || "application/octet-stream" });
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  const method = String(init.method || "GET").toUpperCase();
  const url = new URL(path, "http://dentiva.local");
  const desktop = desktopBridge();
  if (desktop) {
    try {
      const result = await desktop.invoke("api:call", token, `${method} ${url.pathname}`, {
        body: init.json !== undefined ? init.json : {},
        query: Object.fromEntries(url.searchParams),
      });
      if (result && typeof result === "object" && (result as { $binary?: boolean }).$binary) {
        return blobFromIpc(result as { data: string; mime: string }) as T;
      }
      return result as T;
    } catch (err) {
      const e = err as { message?: string; code?: string; details?: unknown };
      throw new ApiError(e.message || "The request could not be completed.", e.code || "INTERNAL", e.details);
    }
  }
  const origin = typeof window !== "undefined" && window.location.protocol === "file:" ? "http://127.0.0.1:4780" : "";
  const res = await fetch(`${origin}${path}`, { ...init, headers, body });
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/pdf") || ct.includes("octet-stream")) {
    if (!res.ok) throw new ApiError("Unable to generate the document.", "IO");
    return (await res.blob()) as T;
  }
  const payload = (await res.json().catch(() => ({}))) as {
    data?: T;
    error?: { code: string; message: string; details?: unknown };
  };
  if (!res.ok) {
    throw new ApiError(payload.error?.message || "The request could not be completed.", payload.error?.code || "INTERNAL", payload.error?.details);
  }
  return payload.data as T;
}

export const AuthApi = {
  setup: () => api<{ needsSetup: boolean; info: { name: string; version: string } }>("/api/meta/setup"),
  bootstrap: (body: unknown) => api("/api/auth/bootstrap", { method: "POST", json: body }),
  login: (username: string, password: string) =>
    api<{ token: string; session: SessionInfo }>("/api/auth/login", { method: "POST", json: { username, password } }),
  logout: () => api("/api/auth/logout", { method: "POST", json: { token: getToken() } }),
  session: () => api<SessionInfo>(`/api/auth/session?token=${encodeURIComponent(getToken() || "")}`),
  lock: () => api<SessionInfo>("/api/auth/lock", { method: "POST", json: { token: getToken() } }),
  unlock: (password: string) => api<SessionInfo>("/api/auth/unlock", { method: "POST", json: { token: getToken(), password } }),
};

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Opens the PDF in a new window and invokes the system print dialog. Falls back to download. */
export function printBlob(blob: Blob, filename = "document.pdf"): void {
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (!w) {
    downloadBlob(blob, filename);
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  const tryPrint = () => {
    try {
      w.focus();
      w.print();
    } catch {
      downloadBlob(blob, filename);
    }
  };
  w.addEventListener("load", tryPrint);
  window.setTimeout(tryPrint, 600);
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

export function formatMoney(paisa: number): string {
  const sign = paisa < 0 ? "-" : "";
  const abs = Math.abs(paisa);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}৳${whole.toLocaleString("en-BD")}.${frac}`;
}

export function todayIsoDate(): string {
  const d = new Date();
  const tz = "Asia/Dhaka";
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function nowIso(): string {
  return new Date().toISOString();
}
