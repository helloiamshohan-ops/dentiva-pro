export type ErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "LOCKED"
  | "UNSAVED"
  | "INTEGRITY"
  | "FINANCIAL"
  | "INVENTORY"
  | "BACKUP"
  | "RESTORE"
  | "IO"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly userMessage: string;
  readonly details?: Record<string, unknown>;
  readonly httpStatus: number;

  constructor(
    code: ErrorCode,
    userMessage: string,
    options?: { cause?: unknown; details?: Record<string, unknown>; httpStatus?: number },
  ) {
    super(userMessage, options?.cause ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.userMessage = userMessage;
    this.details = options?.details;
    this.httpStatus =
      options?.httpStatus ??
      (
        {
          VALIDATION: 400,
          NOT_FOUND: 404,
          CONFLICT: 409,
          UNAUTHORIZED: 401,
          FORBIDDEN: 403,
          LOCKED: 423,
          UNSAVED: 409,
          INTEGRITY: 409,
          FINANCIAL: 409,
          INVENTORY: 409,
          BACKUP: 500,
          RESTORE: 400,
          IO: 500,
          INTERNAL: 500,
        } as const
      )[code];
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export function toUserError(err: unknown): { code: ErrorCode; message: string } {
  if (isAppError(err)) return { code: err.code, message: err.userMessage };
  return {
    code: "INTERNAL",
    message: "Something went wrong. No incomplete changes were kept where a transaction was used. Try again, or contact your administrator if this continues.",
  };
}
