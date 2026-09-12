import { createHash } from "node:crypto";

export const ARBITRUM_CHAIN_ID = 42161;
export const ARGT_ADDRESS = "0x59863989d080B22476DB95656d0C3CC18be92214" as const;
export const ARGT_SYMBOL = "ARGt";
export const ARGT_DECIMALS = 18;

export function arsToArgtBaseUnits(value: string) {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error("ARS amount must be a non-negative decimal with at most two decimals");
  }
  const [whole, fraction = ""] = normalized.split(".");
  return (
    BigInt(whole) * 10n ** BigInt(ARGT_DECIMALS) +
    BigInt(fraction.padEnd(ARGT_DECIMALS, "0"))
  );
}

export function argtBaseUnitsToDisplay(value: string) {
  const baseUnits = BigInt(value);
  const divisor = 10n ** BigInt(ARGT_DECIMALS);
  const whole = baseUnits / divisor;
  const fraction = (baseUnits % divisor).toString().padStart(ARGT_DECIMALS, "0");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole.toString();
}

export function paymentEventHash(
  paymentId: string,
  type: string,
  data: unknown,
  previousHash: string | null,
) {
  return createHash("sha256")
    .update(JSON.stringify({ paymentId, type, data, previousHash }))
    .digest("hex");
}

export function paymentAgentId(companyId: string) {
  return `company:${companyId}`;
}

export async function runSequentially<T>(
  items: readonly T[],
  execute: (item: T, index: number) => Promise<void>,
) {
  let completed = 0;
  for (let index = 0; index < items.length; index += 1) {
    try {
      await execute(items[index], index);
      completed += 1;
    } catch (error) {
      return { completed, failedIndex: index, error };
    }
  }
  return { completed, failedIndex: null, error: null };
}
