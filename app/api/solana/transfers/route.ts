import { transferSplToken } from "@/lib/solana";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.mintAddress || !body.recipient || !body.amount) {
      return Response.json({ error: "mintAddress, recipient and amount are required" }, { status: 400 });
    }
    return Response.json(await transferSplToken({ mintAddress: body.mintAddress, recipient: body.recipient, amount: body.amount }), { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Solana transfer failed" }, { status: 502 });
  }
}
