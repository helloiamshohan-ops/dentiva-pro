import { describe, expect, it } from "vitest";
import {
  parseMoneyInput,
  formatPaisa,
  invoiceTotals,
  outstandingBalance,
  lineTotal,
  taxFromBps,
  assertInvariant,
  paisa,
} from "../../src/core/money.ts";

describe("money", () => {
  it("parses decimal strings into integer paisa", () => {
    expect(parseMoneyInput("1234.56")).toBe(123456);
    expect(parseMoneyInput("1,234.56")).toBe(123456);
    expect(parseMoneyInput("10")).toBe(1000);
    expect(parseMoneyInput("10.5")).toBe(1050);
    expect(parseMoneyInput("-2.25")).toBe(-225);
  });

  it("rejects invalid money strings", () => {
    expect(() => parseMoneyInput("12.345")).toThrow();
    expect(() => parseMoneyInput("abc")).toThrow();
    expect(() => parseMoneyInput("")).toThrow();
  });

  it("formats with grouping", () => {
    expect(formatPaisa(123456)).toBe("৳1,234.56");
    expect(formatPaisa(0)).toBe("৳0.00");
  });

  it("computes line totals without floats", () => {
    expect(lineTotal({ quantity: 3, unitPrice: 15050, discount: 50 })).toBe(45100);
  });

  it("holds subtotal - discount + tax = total", () => {
    const t = invoiceTotals(
      [
        { quantity: 1, unitPrice: 10000, discount: 0 },
        { quantity: 2, unitPrice: 2500, discount: 500 },
      ],
      1000,
      1500,
    );
    expect(t.subtotal).toBe(14500);
    expect(t.total).toBe(15000);
    assertInvariant(t);
  });

  it("computes outstanding with refunds and adjustments", () => {
    expect(outstandingBalance({ total: 10000, payments: 4000, refunds: 1000, adjustments: 500 })).toBe(7500);
  });

  it("taxes with integer basis points", () => {
    expect(taxFromBps(10000, 1500)).toBe(1500);
    expect(taxFromBps(333, 1500)).toBe(49);
  });

  it("rejects non-integer paisa", () => {
    expect(() => paisa(1.2)).toThrow();
  });
});
