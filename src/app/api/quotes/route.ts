import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getUsdcArgtBid } from "@/lib/twin-price";

export const runtime = "nodejs";

const requestSchema = z.object({
  sourceAmount: z.string().regex(/^\d+(\.\d+)?$/).refine((value) => Number(value) > 0),
  purchaseOrderId: z.string().optional(),
  acceptedOfferId: z.string().optional(),
  supplierAgentId: z.string().optional(),
  sourceNetwork: z.string().default("SOLANA"),
  sourceToken: z.string().default("USDC"),
  destinationNetwork: z.string().default("ARBITRUM"),
  destinationToken: z.string().default("ARGt"),
});

const HERMES_FEE_RATE = 0.0015;
const QUOTE_TTL_SECONDS = 15 * 60;

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    if (input.sourceNetwork !== "SOLANA" || input.sourceToken !== "USDC" || input.destinationToken !== "ARGt") {
      return Response.json({ message: "Esta cotización solo soporta USDC en Solana hacia ARGt." }, { status: 400 });
    }

    const exchangeRate = await getUsdcArgtBid();
    const sourceAmount = Number(input.sourceAmount);
    const grossDestination = sourceAmount * Number(exchangeRate);
    const hermesFee = grossDestination * HERMES_FEE_RATE;
    const destinationAmount = grossDestination - hermesFee;
    const expiresAt = new Date(Date.now() + QUOTE_TTL_SECONDS * 1000);
    const format = (value: number) => value.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");

    const quote = await prisma.quote.create({
      data: {
        purchaseOrderId: input.purchaseOrderId,
        acceptedOfferId: input.acceptedOfferId,
        supplierAgentId: input.supplierAgentId,
        sourceNetwork: input.sourceNetwork,
        sourceToken: input.sourceToken,
        sourceAmount: input.sourceAmount,
        destinationNetwork: input.destinationNetwork,
        destinationToken: input.destinationToken,
        destinationAmount: format(destinationAmount),
        exchangeRate,
        bridgeFee: "0",
        swapFee: "0",
        gasFee: "0",
        hermesFee: format(hermesFee),
        expiresAt,
      },
    });

    return Response.json({
      id: quote.id,
      source_amount: quote.sourceAmount,
      destination_amount: quote.destinationAmount,
      exchange_rate: quote.exchangeRate,
      hermes_fee: quote.hermesFee,
      bridge_fee: quote.bridgeFee,
      swap_fee: quote.swapFee,
      gas_fee: quote.gasFee,
      expires_at: quote.expiresAt,
      status: quote.status,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ message: "Datos de cotización inválidos." }, { status: 400 });
    console.error("quote creation failed", error);
    return Response.json({ message: "No se pudo obtener la cotización de Twin." }, { status: 502 });
  }
}
