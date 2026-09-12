import "server-only";

import { isAddress, type Address, type Hex } from "viem";

import {
  DEFAULT_BUYER_COMPANY_ID,
  DEMO_SUPPLIER_COMPANY_IDS,
} from "@/lib/demo-workspace";

const DEMO_BUYER_WALLET = "0xC89258f21CD952eB09de39b40e0557fF472C87aC";
const DEMO_SUPPLIER_WALLET = "0x3f0e3d8e86435a07a1d61532e004a86e722f5de0";

const demoPaymentWallets = {
  [DEFAULT_BUYER_COMPANY_ID]: DEMO_BUYER_WALLET,
  ...Object.fromEntries(
    DEMO_SUPPLIER_COMPANY_IDS.map((companyId) => [companyId, DEMO_SUPPLIER_WALLET]),
  ),
};

function required(name: string, value: string | undefined) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function groqEnv() {
  return {
    apiKey: required("GROQ_API_KEY", process.env.GROQ_API_KEY),
    model: process.env.GROQ_MODEL ?? "openai/gpt-oss-20b",
  };
}

export type PaymentEnvironment = {
  rpcUrl: string;
  privateKey: Hex;
  wallets: Record<string, Address>;
  maxPaymentBaseUnits: bigint;
  requiredConfirmations: number;
};

export function paymentEnvironmentAvailable() {
  try {
    paymentEnv();
    return true;
  } catch {
    return false;
  }
}

export function paymentEnv(): PaymentEnvironment {
  const configuredPrivateKey = required("AGENT_PRIVATE_KEY", process.env.AGENT_PRIVATE_KEY);
  const privateKey = configuredPrivateKey.startsWith("0x")
    ? configuredPrivateKey
    : `0x${configuredPrivateKey}`;
  if (!/^0x[\da-fA-F]{64}$/.test(privateKey)) {
    throw new Error("AGENT_PRIVATE_KEY must be a 32-byte hex private key");
  }

  let parsed: unknown;
  try {
    parsed = process.env.PAYMENT_WALLETS_JSON
      ? JSON.parse(process.env.PAYMENT_WALLETS_JSON)
      : demoPaymentWallets;
  } catch {
    throw new Error("PAYMENT_WALLETS_JSON must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("PAYMENT_WALLETS_JSON must be an object keyed by company UUID");
  }

  const wallets: Record<string, Address> = {};
  for (const [companyId, wallet] of Object.entries(parsed)) {
    if (typeof wallet !== "string" || !isAddress(wallet)) {
      throw new Error(`Invalid payment wallet for company ${companyId}`);
    }
    wallets[companyId] = wallet;
  }

  const maxPaymentBaseUnits = BigInt(required("MAX_PAYMENT_BASE_UNITS", process.env.MAX_PAYMENT_BASE_UNITS));
  if (maxPaymentBaseUnits <= 0n) {
    throw new Error("MAX_PAYMENT_BASE_UNITS must be positive");
  }
  const requiredConfirmations = Number(process.env.REQUIRED_CONFIRMATIONS ?? "1");
  if (!Number.isSafeInteger(requiredConfirmations) || requiredConfirmations < 1) {
    throw new Error("REQUIRED_CONFIRMATIONS must be a positive integer");
  }

  return {
    rpcUrl: required("ARBITRUM_RPC_URL", process.env.ARBITRUM_RPC_URL),
    privateKey: privateKey as Hex,
    wallets,
    maxPaymentBaseUnits,
    requiredConfirmations,
  };
}
