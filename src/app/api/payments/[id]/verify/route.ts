import { decodeEventLog, formatEther } from "viem";
import { prisma } from "@/src/lib/prisma";
import { ARGt, argtAbi, publicClient } from "@/src/lib/chain";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payment = await prisma.payment.findUnique({ where: { id }, include: { events: true } });
  if (!payment) return Response.json({ error: "Payment not found" }, { status: 404 });
  const { txHash } = await request.json();
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  const transfers = receipt.logs.flatMap((log) => {
    if (log.address.toLowerCase() !== ARGt.toLowerCase()) return [];
    try { return [decodeEventLog({ abi: argtAbi, data: log.data, topics: log.topics }).args]; } catch { return []; }
  });
  const match = transfers.some((event) => event.from?.toLowerCase() === payment.payerWallet.toLowerCase() && event.to?.toLowerCase() === payment.payeeWallet.toLowerCase() && event.value === BigInt(payment.amountBaseUnits));
  if (receipt.status !== "success" || !match) return Response.json({ verified: false, error: "Payment does not match request" }, { status: 422 });
  const gasFeeWei = receipt.gasUsed * receipt.effectiveGasPrice;
  const gasData = {
    gasUsedWei: receipt.gasUsed.toString(),
    effectiveGasPriceWei: receipt.effectiveGasPrice.toString(),
    gasFeeWei: gasFeeWei.toString(),
    gasFeeEth: formatEther(gasFeeWei),
  };
  const isSettlement = payment.events.some((event) => event.type === "SOURCE_PAYMENT_CONFIRMED");
  let updated = await prisma.payment.update({
    where: { id },
    data: {
      status: isSettlement ? "DESTINATION_PAYMENT_CONFIRMED" : "PAYMENT_CONFIRMED",
      txHash,
      ...gasData,
      events: { create: { type: isSettlement ? "DESTINATION_PAYMENT_CONFIRMED" : "PAYMENT_CONFIRMED", chainId: payment.chainId, tokenAddress: payment.tokenAddress, tokenSymbol: payment.tokenSymbol, amountBaseUnits: payment.amountBaseUnits, ...gasData, data: { txHash, verified: true, ...gasData }, hash: txHash } },
    },
    include: { events: true },
  });
  if (isSettlement) {
    updated = await prisma.payment.update({
      where: { id },
      data: { status: "SETTLED", events: { create: { type: "SETTLED", chainId: payment.chainId, tokenAddress: payment.tokenAddress, tokenSymbol: payment.tokenSymbol, amountBaseUnits: payment.amountBaseUnits, data: { txHash, sourceConfirmed: true, settled: true }, hash: txHash } } },
      include: { events: true },
    });
  }
  return Response.json({ ...updated, verified: true });
}
