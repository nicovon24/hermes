import { describe, expect, it, vi } from "vitest";

import {
  isStructuredOutputGenerationError,
  withStructuredOutputRetry,
} from "@/modules/protocol/agent/structured-output";

const validationError = {
  status: 400,
  error: {
    error: {
      code: "json_validate_failed",
      failed_generation: "",
    },
  },
};

describe("Groq structured output recovery", () => {
  it("recognizes the nested JSON generation error returned by Groq", () => {
    expect(isStructuredOutputGenerationError(validationError)).toBe(true);
    expect(isStructuredOutputGenerationError({ ...validationError, status: 429 })).toBe(false);
    expect(isStructuredOutputGenerationError({ status: 400, error: { error: { code: "invalid_request" } } })).toBe(false);
  });

  it("retries that generation failure exactly once", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(validationError)
      .mockResolvedValueOnce("valid result");

    await expect(withStructuredOutputRetry(operation)).resolves.toBe("valid result");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry unrelated errors", async () => {
    const error = new Error("authentication failed");
    const operation = vi.fn().mockRejectedValue(error);

    await expect(withStructuredOutputRetry(operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledOnce();
  });
});
