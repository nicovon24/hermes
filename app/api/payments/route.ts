import { prisma } from "@/src/lib/prisma";
import { ARGt } from "@/src/lib/chain";

export async function POST(request: Request) {
  const body = await request.json();
  const payment = await prisma.payment.create({
    data: {
      conversationId: body.conversationId,
      payerAgentId: body.payerAgentId,
      payeeAgentId: body.payeeAgentId,
      payerWallet: body.payerWallet,
      payeeWallet: body.payeeWallet,
      chainId: 42161,
      tokenAddress: ARGt,
      tokenSymbol: "ARGt",
      amountBaseUnits: body.amountBaseUnits,
      externalReference: body.externalReference,
      events: { create: { type: "PAYMENT_REQUESTED", chainId: 42161, tokenAddress: ARGt, tokenSymbol: "ARGt", amountBaseUnits: body.amountBaseUnits, data: {}, hash: "pending" } },
    },
    include: { events: true },
  });
  return Response.json(payment, { status: 201 });
}
