export class BranchChatError extends Error {
  constructor(code, message, { recoverable = true, details = {}, cause } = {}) {
    super(message, { cause });
    this.name = "BranchChatError";
    this.code = code;
    this.recoverable = recoverable;
    this.details = details;
  }
}

export function normalizeError(error) {
  if (error instanceof BranchChatError) return error;
  return new BranchChatError(
    "INTERNAL_ERROR",
    error instanceof Error ? error.message : String(error),
    { recoverable: false, cause: error },
  );
}

export function errorResult(error) {
  const normalized = normalizeError(error);
  return {
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      recoverable: normalized.recoverable,
      details: normalized.details,
    },
  };
}
