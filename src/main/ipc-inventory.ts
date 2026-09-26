/**
 * IPC forensic inventory — privileged channels.
 * Renderer may only call these via the preload bridge.
 */

export type IpcChannel = {
  channel: string;
  purpose: string;
  auth: boolean;
  permission?: string;
  filesystem: boolean;
  sensitivity: "low" | "medium" | "high";
};

export const IPC_INVENTORY: IpcChannel[] = [
  { channel: "auth:bootstrap", purpose: "First-run administrator creation", auth: false, filesystem: false, sensitivity: "high" },
  { channel: "auth:login", purpose: "Local sign-in", auth: false, filesystem: false, sensitivity: "high" },
  { channel: "auth:logout", purpose: "Destroy session", auth: true, filesystem: false, sensitivity: "medium" },
  { channel: "auth:lock", purpose: "Lock the application", auth: true, filesystem: false, sensitivity: "medium" },
  { channel: "auth:unlock", purpose: "Unlock with password", auth: true, filesystem: false, sensitivity: "high" },
  { channel: "auth:session", purpose: "Read session", auth: true, filesystem: false, sensitivity: "medium" },
  { channel: "clinic:get", purpose: "Read clinic settings", auth: true, permission: "patients.read", filesystem: false, sensitivity: "low" },
  { channel: "clinic:update", purpose: "Update clinic settings", auth: true, permission: "settings.manage", filesystem: true, sensitivity: "high" },
  { channel: "patients:*", purpose: "Patient CRUD", auth: true, permission: "patients.write", filesystem: false, sensitivity: "high" },
  { channel: "clinical:*", purpose: "Visits, chart, prescriptions", auth: true, permission: "clinical.write", filesystem: false, sensitivity: "high" },
  { channel: "billing:*", purpose: "Invoices, payments, refunds", auth: true, permission: "billing.write", filesystem: false, sensitivity: "high" },
  { channel: "schedule:*", purpose: "Appointments and queue", auth: true, permission: "appointments.write", filesystem: false, sensitivity: "medium" },
  { channel: "inventory:*", purpose: "Stock and purchases", auth: true, permission: "inventory.write", filesystem: false, sensitivity: "medium" },
  { channel: "documents:pdf", purpose: "Generate PDF bytes", auth: true, filesystem: true, sensitivity: "high" },
  { channel: "backup:create", purpose: "Create backup archive", auth: true, permission: "backup.create", filesystem: true, sensitivity: "high" },
  { channel: "backup:restore", purpose: "Restore archive", auth: true, permission: "backup.restore", filesystem: true, sensitivity: "high" },
  { channel: "attachments:add", purpose: "Store attachment", auth: true, permission: "attachments.write", filesystem: true, sensitivity: "high" },
  { channel: "dialog:open", purpose: "Native file dialog (filtered)", auth: true, permission: "backup.restore", filesystem: true, sensitivity: "high" },
  { channel: "dialog:save", purpose: "Native save dialog", auth: true, filesystem: true, sensitivity: "medium" },
];
