export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, "BAD_REQUEST", message, details);
export const unauthorized = (message = "Please sign in") => new AppError(401, "UNAUTHENTICATED", message);
export const forbidden = (message = "You do not have permission to do this") => new AppError(403, "FORBIDDEN", message);
// Used for records outside the user's scope too, so their existence is not revealed.
export const notFound = (what = "Record") => new AppError(404, "NOT_FOUND", `${what} not found`);
export const conflict = (message: string, details?: unknown) => new AppError(409, "CONFLICT", message, details);
export const rule = (code: string, message: string, details?: unknown) => new AppError(422, code, message, details);

/** Postgres error helpers */
export function pgCode(err: unknown): string | undefined {
  return (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
}
export function pgConstraint(err: unknown): string | undefined {
  const e = err as { constraint?: string; cause?: { constraint?: string } };
  return e?.constraint ?? e?.cause?.constraint;
}
