import { Connection } from "@solana/web3.js";
import { prisma } from "@/src/lib/prisma";
import { ARGt, argtAbi, agentWalletClient } from "@/src/lib/chain";

export async function settleFromSolana(paymentId: string, sourceSignature: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new Error("Payment not found");
  if (payment.status !== "PAYMENT_AUTHORIZED") throw new Error("Payment must be authorized before settlement");

  const solana = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");
  const status = (await solana.getSignatureStatuses([sourceSignature], { searchTransactionHistory: true })).value[0];
  if (!status || status.err || !["confirmed", "finalized"].includes(status.confirmationStatus || "")) {
    throw new Error("Source Solana payment is not confirmed");
  }

  const transaction = await solana.getParsedTransaction(sourceSignature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!transaction) throw new Error("Source Solana transaction not found");
  const expectedMint = process.env.SOLANA_TEST_MINT_ADDRESS;
  if (!expectedMint) throw new Error("SOLANA_TEST_MINT_ADDRESS is not configured");
  const expectedAmount = BigInt(payment.amountBaseUnits) / 10n ** 12n; // ARGt 18 decimals → SPL test token 6 decimals
  const matchingTransfer = transaction.transaction.message.instructions.some((instruction) => {
    if (!("parsed" in instruction) || !instruction.parsed || typeof instruction.parsed !== "object") return false;
    const parsed = instruction.parsed as { type?: string; info?: { mint?: string; amount?: string; tokenAmount?: { amount?: string } } };
    if (parsed.type !== "transfer" && parsed.type !== "transferChecked") return false;
    const amount = parsed.info?.amount ?? parsed.info?.tokenAmount?.amount;
    return parsed.info?.mint === expectedMint && amount === expectedAmount.toString();
  });
  if (!matchingTransfer) throw new Error("Source Solana mint or amount does not match payment");

  const { account, client } = agentWalletClient();
  if (account.address.toLowerCase() !== payment.payerWallet.toLowerCase()) throw new Error("Agent key does not match payer wallet");
  const amount = BigInt(payment.amountBaseUnits);

  await prisma.payment.update({
    where: { id: paymentId },
    data: {
      status: "SOURCE_PAYMENT_CONFIRMED",
      events: { create: { type: "SOURCE_PAYMENT_CONFIRMED", chainId: 0, tokenAddress: "SPL", tokenSymbol: "USDC-DEV", amountBaseUnits: payment.amountBaseUnits, data: { sourceSignature, network: "solana-devnet" }, hash: sourceSignature } },
    },
  });

  const destinationTxHash = await client.writeContract({
    address: ARGt,
    abi: argtAbi,
    functionName: "transfer",
    args: [payment.payeeWallet as `0x${string}`, amount],
  });

  return prisma.payment.update({
    where: { id: paymentId },
    data: {
      status: "DESTINATION_PAYMENT_SUBMITTED",
      txHash: destinationTxHash,
      events: { create: { type: "DESTINATION_PAYMENT_SUBMITTED", chainId: payment.chainId, tokenAddress: payment.tokenAddress, tokenSymbol: payment.tokenSymbol, amountBaseUnits: payment.amountBaseUnits, data: { sourceSignature, destinationTxHash, network: "arbitrum-one" }, hash: destinationTxHash } },
    },
    include: { events: true },
  });
}
