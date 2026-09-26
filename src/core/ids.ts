import { randomUUID, randomBytes } from "node:crypto";
import { INVOICE_PREFIX, PATIENT_CODE_PREFIX, PURCHASE_PREFIX, RECEIPT_PREFIX } from "../shared/constants.ts";

export function newId(): string {
  return randomUUID();
}

export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

export function padSeq(n: number, width = 6): string {
  return String(n).padStart(width, "0");
}

export function formatPatientCode(seq: number, prefix = PATIENT_CODE_PREFIX): string {
  return `${prefix}-${padSeq(seq)}`;
}

export function formatYearlyNumber(prefix: string, year: number, seq: number): string {
  return `${prefix}-${year}-${padSeq(seq)}`;
}

export function formatInvoiceNumber(year: number, seq: number, prefix = INVOICE_PREFIX): string {
  return formatYearlyNumber(prefix, year, seq);
}

export function formatReceiptNumber(year: number, seq: number, prefix = RECEIPT_PREFIX): string {
  return formatYearlyNumber(prefix, year, seq);
}

export function formatPurchaseNumber(year: number, seq: number, prefix = PURCHASE_PREFIX): string {
  return formatYearlyNumber(prefix, year, seq);
}

export function formatQueueSerial(seq: number): string {
  return padSeq(seq, 3);
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
