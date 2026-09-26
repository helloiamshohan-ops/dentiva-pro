/**
 * IPC forensic inventory — privileged channels actually exposed by preload.
 * Renderer may only call these via the contextBridge.
 */

export type IpcChannel = {
  channel: string;
  purpose: string;
  auth: boolean;
  permission?: string;
  filesystem: boolean;
  sensitivity: "low" | "medium" | "high";
};

export const PRELOAD_ALLOWED_CHANNELS = [
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
] as const;

export const IPC_INVENTORY: IpcChannel[] = [
  { channel: "meta:setup", purpose: "First-run detection", auth: false, filesystem: false, sensitivity: "low" },
  { channel: "auth:bootstrap", purpose: "First-run administrator creation", auth: false, filesystem: false, sensitivity: "high" },
  { channel: "auth:login", purpose: "Local sign-in", auth: false, filesystem: false, sensitivity: "high" },
  { channel: "auth:logout", purpose: "Destroy session", auth: true, filesystem: false, sensitivity: "medium" },
  { channel: "auth:lock", purpose: "Lock the application", auth: true, filesystem: false, sensitivity: "medium" },
  { channel: "auth:unlock", purpose: "Unlock with password", auth: true, filesystem: false, sensitivity: "high" },
  { channel: "auth:session", purpose: "Read session", auth: true, filesystem: false, sensitivity: "medium" },
  {
    channel: "api:call",
    purpose: "Domain operations via METHOD /api/... sharing HTTP handlers",
    auth: true,
    permission: "per-route",
    filesystem: false,
    sensitivity: "high",
  },
  { channel: "dialog:openBackup", purpose: "Native backup file picker", auth: true, permission: "backup.restore", filesystem: true, sensitivity: "high" },
  { channel: "dialog:savePdf", purpose: "Native save dialog for PDFs", auth: true, filesystem: true, sensitivity: "medium" },
];
