import { prisma } from "@/src/lib/prisma";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payment = await prisma.payment.findUnique({ where: { id } });
  if (!payment) return Response.json({ error: "Payment not found" }, { status: 404 });
  if (payment.status !== "PAYMENT_REQUESTED") return Response.json({ error: "Invalid payment state" }, { status: 409 });
  return Response.json(await prisma.payment.update({ where: { id }, data: { status: "PAYMENT_AUTHORIZED", events: { create: { type: "PAYMENT_AUTHORIZED", chainId: payment.chainId, tokenAddress: payment.tokenAddress, tokenSymbol: payment.tokenSymbol, amountBaseUnits: payment.amountBaseUnits, data: {}, hash: "pending" } } }, include: { events: true } }));
}
