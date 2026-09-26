import { PAISA_PER_UNIT } from "../shared/constants.ts";
import { AppError } from "./errors.ts";

/** Integer smallest currency unit. For BDT this is paisa. */
export type Paisa = number;

const MAX_ABS = 9_000_000_000_000; // 90 billion units — well above clinic scale

export function assertPaisa(value: unknown, field = "amount"): Paisa {
  if (typeof value !== "number" || !Number.isInteger(value) || !Number.isSafeInteger(value)) {
    throw new AppError("VALIDATION", `Enter a valid amount for ${field}.`, { details: { field } });
  }
  if (Math.abs(value) > MAX_ABS) {
    throw new AppError("VALIDATION", `The amount for ${field} is outside the supported range.`, {
      details: { field },
    });
  }
  return value;
}

export function paisa(value: number): Paisa {
  return assertPaisa(value);
}

/**
 * Parse a user-entered money string into integer paisa.
 * Accepts "1234.56", "1,234.56", "1234", "1234.5".
 * Rejects floats as input numbers with extra precision — pass strings from UI.
 */
export function parseMoneyInput(input: string, field = "amount"): Paisa {
  const raw = input.replace(/,/g, "").trim();
  if (!raw) {
    throw new AppError("VALIDATION", `Enter an amount for ${field}.`, { details: { field } });
  }
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) {
    throw new AppError(
      "VALIDATION",
      `Enter ${field} as a valid amount with up to two decimal places.`,
      { details: { field } },
    );
  }
  const sign = match[1] ? -1 : 1;
  const whole = Number(match[2]);
  const frac = (match[3] ?? "").padEnd(2, "0");
  const fraction = Number(frac);
  const value = sign * (whole * PAISA_PER_UNIT + fraction);
  return assertPaisa(value, field);
}

export function paisaFromMajor(major: number, field = "amount"): Paisa {
  if (!Number.isFinite(major)) {
    throw new AppError("VALIDATION", `Enter a valid amount for ${field}.`);
  }
  const sign = major < 0 ? -1 : 1;
  const abs = Math.abs(major);
  const whole = Math.floor(abs + 1e-9);
  const frac = Math.round((abs - whole) * PAISA_PER_UNIT);
  if (frac === PAISA_PER_UNIT) {
    return assertPaisa(sign * (whole + 1) * PAISA_PER_UNIT, field);
  }
  return assertPaisa(sign * (whole * PAISA_PER_UNIT + frac), field);
}

export function formatPaisa(value: Paisa, options?: { symbol?: string; signed?: boolean }): string {
  assertPaisa(value);
  const symbol = options?.symbol ?? "৳";
  const sign = value < 0 ? "-" : options?.signed ? "+" : "";
  const abs = Math.abs(value);
  const whole = Math.floor(abs / PAISA_PER_UNIT);
  const frac = String(abs % PAISA_PER_UNIT).padStart(2, "0");
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${symbol}${grouped}.${frac}`;
}

export function formatPaisaPlain(value: Paisa): string {
  assertPaisa(value);
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const whole = Math.floor(abs / PAISA_PER_UNIT);
  const frac = String(abs % PAISA_PER_UNIT).padStart(2, "0");
  return `${sign}${whole}.${frac}`;
}

export function addPaisa(...values: Paisa[]): Paisa {
  let total = 0;
  for (const v of values) {
    total += assertPaisa(v);
    if (!Number.isSafeInteger(total)) {
      throw new AppError("FINANCIAL", "The calculated amount is outside the supported range.");
    }
  }
  return total;
}

export function subPaisa(a: Paisa, b: Paisa): Paisa {
  return addPaisa(assertPaisa(a), -assertPaisa(b));
}

export function mulQty(unitPaisa: Paisa, quantity: number): Paisa {
  assertPaisa(unitPaisa, "unit price");
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new AppError("VALIDATION", "Quantity must be a whole number of 0 or more.");
  }
  const product = unitPaisa * quantity;
  return assertPaisa(product, "line total");
}

export type InvoiceTotals = {
  subtotal: Paisa;
  discount: Paisa;
  tax: Paisa;
  total: Paisa;
};

export type LineInput = {
  quantity: number;
  unitPrice: Paisa;
  discount: Paisa;
};

export function lineTotal(line: LineInput): Paisa {
  const gross = mulQty(line.unitPrice, line.quantity);
  const discount = assertPaisa(line.discount, "line discount");
  if (discount < 0) {
    throw new AppError("VALIDATION", "Line discount cannot be negative.");
  }
  if (discount > gross) {
    throw new AppError("VALIDATION", "Line discount cannot exceed the line amount.");
  }
  return subPaisa(gross, discount);
}

/**
 * subtotal - discount + tax = total
 */
export function invoiceTotals(
  lines: LineInput[],
  invoiceDiscount: Paisa,
  tax: Paisa,
): InvoiceTotals {
  let subtotal = 0;
  for (const line of lines) {
    subtotal = addPaisa(subtotal, lineTotal(line));
  }
  const discount = assertPaisa(invoiceDiscount, "discount");
  const taxAmt = assertPaisa(tax, "tax");
  if (discount < 0) throw new AppError("VALIDATION", "Discount cannot be negative.");
  if (taxAmt < 0) throw new AppError("VALIDATION", "Tax cannot be negative.");
  if (discount > subtotal) {
    throw new AppError("VALIDATION", "Invoice discount cannot exceed the subtotal.");
  }
  const total = addPaisa(subPaisa(subtotal, discount), taxAmt);
  if (total < 0) throw new AppError("FINANCIAL", "Invoice total cannot be negative.");
  return { subtotal, discount, tax: taxAmt, total };
}

/**
 * outstanding = total - payments + refunds + adjustments
 * adjustment > 0 increases amount owed; < 0 reduces it.
 */
export function outstandingBalance(args: {
  total: Paisa;
  payments: Paisa;
  refunds: Paisa;
  adjustments: Paisa;
}): Paisa {
  const total = assertPaisa(args.total, "total");
  const payments = assertPaisa(args.payments, "payments");
  const refunds = assertPaisa(args.refunds, "refunds");
  const adjustments = assertPaisa(args.adjustments, "adjustments");
  if (payments < 0 || refunds < 0) {
    throw new AppError("FINANCIAL", "Payment and refund totals cannot be negative.");
  }
  return addPaisa(total, -payments, refunds, adjustments);
}

export function taxFromBps(base: Paisa, bps: number): Paisa {
  assertPaisa(base, "tax base");
  if (!Number.isInteger(bps) || bps < 0 || bps > 100_000) {
    throw new AppError("VALIDATION", "Tax rate is invalid.");
  }
  // integer math: floor((base * bps) / 10000)
  return Math.trunc((base * bps) / 10_000);
}

export function assertInvariant(totals: InvoiceTotals): void {
  const expected = addPaisa(subPaisa(totals.subtotal, totals.discount), totals.tax);
  if (expected !== totals.total) {
    throw new AppError("FINANCIAL", "Invoice totals do not balance. No financial changes were saved.", {
      details: { ...totals, expected },
    });
  }
}
