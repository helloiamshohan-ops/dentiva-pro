import { z } from "zod";
import { PAYMENT_METHODS, ROLES } from "../shared/constants.ts";
import { AppError } from "./errors.ts";

export const phoneSchema = z
  .string()
  .trim()
  .min(6, "Enter a valid phone number.")
  .max(32, "Phone number is too long.")
  .regex(/^[0-9+()\-\s]+$/, "Phone number contains invalid characters.");

export const optionalPhone = z
  .string()
  .trim()
  .max(32)
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : undefined));

export const emailSchema = z
  .string()
  .trim()
  .email("Enter a valid email address.")
  .max(180);

export const optionalEmail = z
  .string()
  .trim()
  .max(180)
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? v : undefined))
  .refine((v) => !v || emailSchema.safeParse(v).success, "Enter a valid email address.");

export function normalizePhone(phone: string | undefined | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  return digits || null;
}

export function parse<S extends z.ZodTypeAny>(
  schema: S,
  data: unknown,
  message = "Some fields need attention before saving.",
): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new AppError("VALIDATION", first?.message ?? message, {
      details: { issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
    });
  }
  return result.data;
}

export const paginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(50),
});

export type Page = z.output<typeof paginationSchema>;

export function pageOffset(p: { page: number; pageSize: number }): { limit: number; offset: number } {
  return { limit: p.pageSize, offset: (p.page - 1) * p.pageSize };
}

export const roleSchema = z.enum(ROLES);
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);

export const nonEmpty = (label: string, max = 200) =>
  z.string().trim().min(1, `Enter ${label}.`).max(max, `${label} is too long.`);

export function requireId(id: string | undefined, label = "record"): string {
  if (!id || typeof id !== "string" || id.length < 8) {
    throw new AppError("VALIDATION", `A valid ${label} is required.`);
  }
  return id;
}
