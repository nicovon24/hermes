import { createPublicClient, createWalletClient, http, parseAbi, type Hex } from "viem";
import { arbitrum } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

export const ARGt = "0x59863989d080B22476DB95656d0C3CC18be92214" as const;
export const argtAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function transfer(address to, uint256 value) returns (bool)",
]);

export const publicClient = createPublicClient({
  chain: arbitrum,
  transport: http(process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc"),
});

export function agentAccount() {
  const raw = process.env.AGENT_PRIVATE_KEY?.trim();
  if (!raw) throw new Error("AGENT_PRIVATE_KEY is not configured");
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  return privateKeyToAccount(key);
}

export function agentWalletClient() {
  const account = agentAccount();
  return { account, client: createWalletClient({ account, chain: arbitrum, transport: http(process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc") }) };
}
