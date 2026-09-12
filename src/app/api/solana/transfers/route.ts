import { transferSplToken } from "@/lib/solana";

export async function POST(request: Request) {
  try {
    const requiredKey = process.env.HERMES_INTERNAL_API_KEY;
    if (!requiredKey || request.headers.get("x-hermes-api-key") !== requiredKey) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json();
    if (typeof body.mintAddress !== "string" || typeof body.recipient !== "string" || typeof body.amount !== "string" || !body.mintAddress || !body.recipient || !body.amount) {
      return Response.json({ error: "mintAddress, recipient and amount are required" }, { status: 400 });
    }
    return Response.json(await transferSplToken({ mintAddress: body.mintAddress, recipient: body.recipient, amount: body.amount }), { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Solana transfer failed";
    const invalid = message.startsWith("Invalid") || message.includes("too many decimals") || message.includes("must be configured");
    return Response.json({ error: message }, { status: invalid ? 400 : 502 });
  }
}
