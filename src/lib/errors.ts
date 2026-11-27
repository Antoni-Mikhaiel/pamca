/**
 * An error whose message is written for the customer (e.g. "Only 3 left in stock")
 * and is safe to show as-is. Anything else — database, Square, Canada Post or
 * programming errors — is logged on the server and replaced by a generic message,
 * so internals (table names, provider responses, stack details) never reach a visitor.
 */
export class UserError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "UserError";
    this.status = status;
  }
}

export const GENERIC_ERROR = "Something went wrong. Please try again, or contact us if it keeps happening.";

/** The message to show a visitor for `error`; logs anything that isn't a UserError. */
export function publicErrorMessage(error: unknown, context: string, fallback = GENERIC_ERROR): string {
  if (error instanceof UserError) return error.message;
  console.error(`[${context}]`, error);
  return fallback;
}
