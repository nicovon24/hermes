import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  type Commitment,
} from "@solana/web3.js";
import {
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddress,
  getMint,
} from "@solana/spl-token";

const commitment: Commitment = "confirmed";

export function solanaConnection() {
  return new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", commitment);
}

export function solanaAgentKeypair() {
  const raw = process.env.SOLANA_AGENT_PRIVATE_KEY?.trim();
  if (!raw) throw new Error("SOLANA_AGENT_PRIVATE_KEY is not configured");
  let bytes: unknown;
  try { bytes = JSON.parse(raw); } catch { throw new Error("SOLANA_AGENT_PRIVATE_KEY must be a JSON array"); }
  if (!Array.isArray(bytes) || bytes.length !== 64 || !bytes.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
    throw new Error("SOLANA_AGENT_PRIVATE_KEY must contain 64 bytes");
  }
  return Keypair.fromSecretKey(Uint8Array.from(bytes as number[]));
}

function decimalToUnits(amount: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(amount)) throw new Error("Invalid token amount");
  const [integerPart, decimalPart = ""] = amount.split(".");
  if (decimalPart.length > decimals) throw new Error("Amount has too many decimals");
  return BigInt(integerPart) * 10n ** BigInt(decimals) + BigInt(decimalPart.padEnd(decimals, "0") || "0");
}

export async function transferSplToken(input: { mintAddress: string; recipient: string; amount: string }) {
  const connection = solanaConnection();
  const payer = solanaAgentKeypair();
  const mint = new PublicKey(input.mintAddress);
  const recipient = new PublicKey(input.recipient);
  const mintInfo = await getMint(connection, mint, commitment);
  const amount = decimalToUnits(input.amount, mintInfo.decimals);
  const sourceAta = await getAssociatedTokenAddress(mint, payer.publicKey);
  const destinationAta = await getAssociatedTokenAddress(mint, recipient);
  const sourceAccount = await getAccount(connection, sourceAta, commitment);
  const destinationAccount = await getAccount(connection, destinationAta, commitment);
  if (sourceAccount.amount < amount) throw new Error("Insufficient SPL token balance");

  const transaction = new Transaction().add(
    createTransferCheckedInstruction(sourceAccount.address, mint, destinationAccount.address, payer.publicKey, amount, mintInfo.decimals),
  );
  const latestBlockhash = await connection.getLatestBlockhash(commitment);
  transaction.recentBlockhash = latestBlockhash.blockhash;
  transaction.feePayer = payer.publicKey;
  transaction.sign(payer);
  const signature = await connection.sendRawTransaction(transaction.serialize());
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await connection.getSignatureStatuses([signature]);
    const status = result.value[0];
    if (status?.err) throw new Error(`Solana transaction failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (attempt === 29) throw new Error("Solana transaction confirmation timed out");
  }
  return {
    signature,
    source: payer.publicKey.toBase58(),
    destination: recipient.toBase58(),
    mintAddress: mint.toBase58(),
    amount: input.amount,
    decimals: mintInfo.decimals,
    network: "solana-devnet",
    status: "confirmed" as const,
  };
}
