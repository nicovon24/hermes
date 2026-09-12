import "server-only";

import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export async function serializableTransaction<T>(
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2002", "P2034"].includes(error.code);
      if (!retryable || attempt === 7) throw error;
      // Parallel suppliers can contend on PostgreSQL predicate locks even when
      // they update different rows. Backoff prevents synchronized retry storms.
      await new Promise((resolve) => setTimeout(resolve, Math.min(20 * 2 ** attempt, 300) + Math.floor(Math.random() * 20)));
    }
  }
  throw lastError;
}
