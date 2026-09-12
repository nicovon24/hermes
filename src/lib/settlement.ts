import { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { prisma } from "@/lib/prisma";
import { ARGt, argtAbi, agentWalletClient, publicClient } from "@/lib/chain";
import { formatEther } from "viem";

export async function settleFromSolana(paymentId: string, sourceSignature: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new Error("Payment not found");
  if (payment.route !== "SOLANA_TO_ARBITRUM") throw new Error("Payment route does not use Solana settlement");
  if (payment.status !== "PAYMENT_AUTHORIZED") throw new Error("Payment must be authorized before settlement");

  const solana = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");
  const status = (await solana.getSignatureStatuses([sourceSignature], { searchTransactionHistory: true })).value[0];
  if (!status || status.err || !["confirmed", "finalized"].includes(status.confirmationStatus || "")) {
    throw new Error("Source Solana payment is not confirmed");
  }

  const transaction = await solana.getParsedTransaction(sourceSignature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!transaction) throw new Error("Source Solana transaction not found");
  const expectedMint = process.env.SOLANA_USDC_MINT || process.env.SOLANA_TEST_MINT_ADDRESS;
  if (!expectedMint) throw new Error("SOLANA_TEST_MINT_ADDRESS is not configured");
  const quote = payment.quoteId ? await prisma.quote.findUnique({ where: { id: payment.quoteId } }) : null;
  if (!quote || quote.expiresAt <= new Date()) throw new Error("Payment quote is missing or expired");
  const [sourceWhole, sourceFraction = ""] = quote.sourceAmount.split(".");
  const expectedAmount = BigInt(sourceWhole) * 10n ** 6n + BigInt(sourceFraction.padEnd(6, "0").slice(0, 6));
  const baseUnits = BigInt(payment.amountBaseUnits);
  if (baseUnits <= 0n) throw new Error("Payment amount must be positive");
  if (expectedAmount > 18446744073709551615n) throw new Error("Payment amount exceeds SPL token range");
  const expectedAuthority = process.env.SOLANA_SOURCE_WALLET;
  if (!expectedAuthority) throw new Error("SOLANA_SOURCE_WALLET is not configured");
  const expectedDestinationWallet = process.env.SOLANA_SETTLEMENT_WALLET;
  if (!expectedDestinationWallet) throw new Error("SOLANA_SETTLEMENT_WALLET is not configured");
  const expectedDestination = (await getAssociatedTokenAddress(new PublicKey(expectedMint), new PublicKey(expectedDestinationWallet))).toBase58();
  const matchingTransfer = transaction.transaction.message.instructions.some((instruction) => {
    if (!("parsed" in instruction) || !instruction.parsed || typeof instruction.parsed !== "object") return false;
    const parsed = instruction.parsed as { type?: string; info?: { mint?: string; amount?: string; source?: string; destination?: string; authority?: string; tokenAmount?: { amount?: string } } };
    if (parsed.type !== "transfer" && parsed.type !== "transferChecked") return false;
    const amount = parsed.info?.amount ?? parsed.info?.tokenAmount?.amount;
    return parsed.info?.mint === expectedMint && amount === expectedAmount.toString() && parsed.info?.authority === expectedAuthority && !!parsed.info?.destination;
  });
  if (!matchingTransfer) throw new Error("Source Solana mint or amount does not match payment");
  const transferInstruction = transaction.transaction.message.instructions.find((instruction) => {
    if (!("parsed" in instruction) || !instruction.parsed || typeof instruction.parsed !== "object") return false;
    const parsed = instruction.parsed as { type?: string; info?: { destination?: string } };
    return (parsed.type === "transfer" || parsed.type === "transferChecked") && !!parsed.info?.destination;
  });
  const destination = (transferInstruction as { parsed?: { info?: { destination?: string } } })?.parsed?.info?.destination;
  if (!destination) throw new Error("Source Solana destination is missing");
  const destinationInfo = await solana.getParsedAccountInfo(new PublicKey(destination), { commitment: "confirmed" });
  const owner = (destinationInfo.value?.data as { parsed?: { info?: { owner?: string; mint?: string } } })?.parsed?.info?.owner;
  const destinationMint = (destinationInfo.value?.data as { parsed?: { info?: { owner?: string; mint?: string } } })?.parsed?.info?.mint;
  if (owner !== expectedDestinationWallet || destinationMint !== expectedMint) throw new Error("Source Solana destination does not belong to settlement wallet");

  const { account, client } = agentWalletClient();
  if (account.address.toLowerCase() !== payment.payerWallet.toLowerCase()) throw new Error("Agent key does not match payer wallet");
  const amount = BigInt(payment.amountBaseUnits);

  await prisma.payment.update({
    where: { id: paymentId },
    data: {
      status: "SOURCE_PAYMENT_CONFIRMED",
      events: { create: { type: "SOURCE_PAYMENT_CONFIRMED", chainId: 0, tokenAddress: expectedMint, tokenSymbol: "USDC", amountBaseUnits: expectedAmount.toString(), data: { sourceSignature, network: "solana-mainnet", quoteId: quote.id }, hash: sourceSignature } },
    },
  });

  const destinationTxHash = await client.writeContract({
    address: ARGt,
    abi: argtAbi,
    functionName: "transfer",
    args: [payment.payeeWallet as `0x${string}`, amount],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: destinationTxHash, confirmations: 1 });
  if (receipt.status !== "success") throw new Error("Destination Arbitrum payment failed");
  const gasFee = receipt.gasUsed * receipt.effectiveGasPrice;

  return prisma.payment.update({
    where: { id: paymentId },
    data: {
      status: "DESTINATION_PAYMENT_CONFIRMED",
      txHash: destinationTxHash,
      gasUsedWei: receipt.gasUsed.toString(), effectiveGasPriceWei: receipt.effectiveGasPrice.toString(), gasFeeWei: gasFee.toString(), gasFeeEth: formatEther(gasFee),
      events: { create: { type: "DESTINATION_PAYMENT_CONFIRMED", chainId: payment.chainId, tokenAddress: payment.tokenAddress, tokenSymbol: payment.tokenSymbol, amountBaseUnits: payment.amountBaseUnits, gasUsedWei: receipt.gasUsed.toString(), effectiveGasPriceWei: receipt.effectiveGasPrice.toString(), gasFeeWei: gasFee.toString(), gasFeeEth: formatEther(gasFee), data: { sourceSignature, destinationTxHash, network: "arbitrum-one", confirmed: true }, hash: destinationTxHash } },
    },
    include: { events: true },
  });
}
