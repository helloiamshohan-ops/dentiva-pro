import { describe, expect, it } from "vitest";
import { permissionsFor, hasPermission } from "../../src/core/rbac.ts";

describe("rbac", () => {
  it("gives administrators every permission", () => {
    const p = permissionsFor("administrator");
    expect(hasPermission(p, "backup.restore")).toBe(true);
    expect(hasPermission(p, "billing.refund")).toBe(true);
  });

  it("does not let receptionists refund", () => {
    const p = permissionsFor("receptionist");
    expect(hasPermission(p, "billing.write")).toBe(true);
    expect(hasPermission(p, "billing.refund")).toBe(false);
    expect(hasPermission(p, "clinical.write")).toBe(false);
  });

  it("limits inventory staff", () => {
    const p = permissionsFor("inventory_staff");
    expect(hasPermission(p, "inventory.adjust")).toBe(true);
    expect(hasPermission(p, "patients.write")).toBe(false);
  });
});
