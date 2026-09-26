import type { Role } from "../shared/constants.ts";

export const PERMISSIONS = [
  "patients.read",
  "patients.write",
  "clinical.read",
  "clinical.write",
  "prescriptions.write",
  "appointments.read",
  "appointments.write",
  "queue.manage",
  "billing.read",
  "billing.write",
  "billing.refund",
  "accounting.read",
  "accounting.write",
  "inventory.read",
  "inventory.write",
  "inventory.adjust",
  "reports.view",
  "staff.manage",
  "settings.manage",
  "backup.create",
  "backup.restore",
  "audit.view",
  "attachments.write",
  "import.export",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  administrator: ALL,
  dentist: [
    "patients.read",
    "patients.write",
    "clinical.read",
    "clinical.write",
    "prescriptions.write",
    "appointments.read",
    "appointments.write",
    "queue.manage",
    "billing.read",
    "reports.view",
    "attachments.write",
  ],
  receptionist: [
    "patients.read",
    "patients.write",
    "clinical.read",
    "appointments.read",
    "appointments.write",
    "queue.manage",
    "billing.read",
    "billing.write",
    "attachments.write",
    "import.export",
  ],
  accountant: [
    "patients.read",
    "billing.read",
    "billing.write",
    "billing.refund",
    "accounting.read",
    "accounting.write",
    "reports.view",
    "audit.view",
  ],
  inventory_staff: [
    "inventory.read",
    "inventory.write",
    "inventory.adjust",
    "reports.view",
  ],
};

export function permissionsFor(role: Role, extra?: Permission[]): Set<Permission> {
  const set = new Set<Permission>(ROLE_PERMISSIONS[role] ?? []);
  if (extra) for (const p of extra) set.add(p);
  return set;
}

export function hasPermission(granted: Iterable<string>, needed: Permission): boolean {
  const set = granted instanceof Set ? granted : new Set(granted);
  return set.has(needed);
}
