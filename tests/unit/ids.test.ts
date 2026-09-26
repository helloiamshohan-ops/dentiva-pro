import { describe, expect, it } from "vitest";
import { formatPatientCode, formatInvoiceNumber, formatReceiptNumber, formatQueueSerial, isUuid, newId } from "../../src/core/ids.ts";

describe("identifiers", () => {
  it("formats stable patient codes", () => {
    expect(formatPatientCode(1)).toBe("P-000001");
    expect(formatPatientCode(42, "DVP")).toBe("DVP-000042");
  });

  it("keeps invoice and receipt series distinct", () => {
    expect(formatInvoiceNumber(2026, 1)).toBe("INV-2026-000001");
    expect(formatReceiptNumber(2026, 1)).toBe("RCT-2026-000001");
    expect(formatQueueSerial(7)).toBe("007");
  });

  it("creates uuids", () => {
    expect(isUuid(newId())).toBe(true);
  });
});
