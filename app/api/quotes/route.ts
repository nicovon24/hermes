import { prisma } from "@/src/lib/prisma";

const HERMES_FEE_BPS = 15n; // 0.15%
const BPS_DENOMINATOR = 10_000n;

function amountToBaseUnits(value: string | number): bigint {
  const normalized = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) throw new Error("Invalid amount");
  const [integerPart, decimalPart = ""] = normalized.split(".");
  const decimals = decimalPart.padEnd(18, "0").slice(0, 18);
  return BigInt(integerPart) * 10n ** 18n + BigInt(decimals || "0");
}

function baseUnitsToAmount(value: bigint): string {
  const integerPart = value / 10n ** 18n;
  const decimalPart = (value % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return decimalPart ? `${integerPart}.${decimalPart}` : integerPart.toString();
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sourceAmount = amountToBaseUnits(body.sourceAmount);
    if (sourceAmount <= 0n) return Response.json({ error: "sourceAmount must be positive" }, { status: 400 });

    const bridgeFee = amountToBaseUnits(body.bridgeFee ?? "0");
    const swapFee = amountToBaseUnits(body.swapFee ?? "0");
    const gasFee = amountToBaseUnits(body.gasFee ?? "0");
    const hermesFee = (sourceAmount * HERMES_FEE_BPS) / BPS_DENOMINATOR;
    const totalFees = bridgeFee + swapFee + gasFee + hermesFee;
    const destinationAmount = sourceAmount - totalFees;
    if (destinationAmount <= 0n) return Response.json({ error: "Fees exceed source amount" }, { status: 400 });

    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : new Date(Date.now() + 15 * 60 * 1000);
    if (Number.isNaN(expiresAt.getTime())) return Response.json({ error: "Invalid expiresAt" }, { status: 400 });

    const quote = await prisma.quote.create({
      data: {
        sourceNetwork: body.sourceNetwork,
        sourceToken: body.sourceToken,
        sourceAmount: body.sourceAmount.toString(),
        destinationNetwork: body.destinationNetwork,
        destinationToken: body.destinationToken,
        destinationAmount: baseUnitsToAmount(destinationAmount),
        bridgeFee: body.bridgeFee ?? "0",
        swapFee: body.swapFee ?? "0",
        gasFee: body.gasFee ?? "0",
        hermesFee: baseUnitsToAmount(hermesFee),
        expiresAt,
      },
    });

    return Response.json(quote, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not create quote" }, { status: 400 });
  }
}
