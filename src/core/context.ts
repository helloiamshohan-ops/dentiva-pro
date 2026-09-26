import type { Role } from "../shared/constants.ts";
import type { Permission } from "./rbac.ts";
import { hasPermission } from "./rbac.ts";
import { AppError } from "./errors.ts";
import type { Sqlite } from "./db/connection.ts";

export type Actor = {
  sessionId: string;
  staffId: string;
  name: string;
  username: string;
  role: Role;
  permissions: Set<Permission>;
};

export type AppPaths = {
  dataDir: string;
  dbPath: string;
  attachmentsDir: string;
  backupDir: string;
  tempDir: string;
  recoveryMarker: string;
};

export type Core = {
  db: Sqlite;
  paths: AppPaths;
  clock: () => Date;
};

export function requireActor(actor: Actor | null | undefined): Actor {
  if (!actor) {
    throw new AppError("UNAUTHORIZED", "Please sign in to continue.");
  }
  return actor;
}

export function requirePermission(actor: Actor | null | undefined, permission: Permission): Actor {
  const a = requireActor(actor);
  if (!hasPermission(a.permissions, permission)) {
    throw new AppError("FORBIDDEN", "You do not have permission to perform this action.");
  }
  return a;
}

export function requireAny(actor: Actor | null | undefined, permissions: Permission[]): Actor {
  const a = requireActor(actor);
  if (!permissions.some((p) => hasPermission(a.permissions, p))) {
    throw new AppError("FORBIDDEN", "You do not have permission to perform this action.");
  }
  return a;
}
