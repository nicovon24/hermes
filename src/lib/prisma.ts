import "server-only";

import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
type TransactionTiming = { maxWait?: number; timeout?: number };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

async function transactionWithRetry<T>(
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  isolationLevel: Prisma.TransactionIsolationLevel,
  timing: TransactionTiming = {},
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel,
        maxWait: timing.maxWait ?? 10_000,
        timeout: timing.timeout ?? 30_000,
      });
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P1017", "P2002", "P2028", "P2034"].includes(error.code);
      if (!retryable || attempt === 7) throw error;
      // Backoff prevents synchronized retry storms after a conflict or deadlock.
      await new Promise((resolve) => setTimeout(resolve, Math.min(20 * 2 ** attempt, 300) + Math.floor(Math.random() * 20)));
    }
  }
  throw lastError;
}

export function serializableTransaction<T>(
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  timing?: TransactionTiming,
) {
  return transactionWithRetry(
    operation,
    Prisma.TransactionIsolationLevel.Serializable,
    timing,
  );
}

export function readCommittedTransaction<T>(
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  timing?: TransactionTiming,
) {
  return transactionWithRetry(
    operation,
    Prisma.TransactionIsolationLevel.ReadCommitted,
    timing,
  );
}
