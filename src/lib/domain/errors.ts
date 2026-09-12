export class DomainError extends Error {
  constructor(
    message: string,
    readonly code:
      | "UNAUTHENTICATED"
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "CONFLICT"
      | "VALIDATION_ERROR"
      | "INTERNAL_ERROR",
    readonly status: number,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function toDomainError(error: unknown) {
  if (error instanceof DomainError) return error;

  console.error(error);
  return new DomainError("Unexpected server error", "INTERNAL_ERROR", 500);
}
