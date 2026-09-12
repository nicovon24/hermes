function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function isStructuredOutputGenerationError(error: unknown) {
  const apiError = record(error);
  const response = record(apiError.error);
  const details = record(response.error);
  const code = details.code ?? response.code;
  return apiError.status === 400 && code === "json_validate_failed";
}

/** Retry only Groq's transient model-generation failure, never arbitrary 4xx errors. */
export async function withStructuredOutputRetry<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (!isStructuredOutputGenerationError(error)) throw error;
    return operation();
  }
}
