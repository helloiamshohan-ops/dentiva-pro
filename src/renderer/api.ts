import type { SessionInfo } from "../shared/types.ts";

const TOKEN_KEY = "dentiva.token";

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

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
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
