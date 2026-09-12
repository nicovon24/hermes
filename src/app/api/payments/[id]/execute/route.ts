import { prisma } from "@/src/lib/prisma";
import { ARGt, argtAbi, agentWalletClient } from "@/src/lib/chain";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payment = await prisma.payment.findUnique({ where: { id } });
  if (!payment) return Response.json({ error: "Payment not found" }, { status: 404 });
  if (payment.status !== "PAYMENT_AUTHORIZED") return Response.json({ error: "Payment must be authorized" }, { status: 409 });
  const max = BigInt(process.env.MAX_PAYMENT_BASE_UNITS || "1000000000000000000000");
  const amount = BigInt(payment.amountBaseUnits);
  if (amount > max) return Response.json({ error: "Payment exceeds policy limit" }, { status: 403 });
  try {
    const { account, client } = agentWalletClient();
    if (account.address.toLowerCase() !== payment.payerWallet.toLowerCase()) return Response.json({ error: "Agent key does not match payer wallet" }, { status: 403 });
    const hash = await client.writeContract({ address: ARGt, abi: argtAbi, functionName: "transfer", args: [payment.payeeWallet as `0x${string}`, amount] });
    return Response.json(await prisma.payment.update({ where: { id }, data: { status: "PAYMENT_SUBMITTED", txHash: hash, events: { create: { type: "PAYMENT_SUBMITTED", chainId: payment.chainId, tokenAddress: payment.tokenAddress, tokenSymbol: payment.tokenSymbol, amountBaseUnits: payment.amountBaseUnits, data: { txHash: hash, autonomous: true }, hash } } }, include: { events: true } }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Payment execution failed" }, { status: 502 });
  }
}
