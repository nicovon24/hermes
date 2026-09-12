import { settleFromSolana } from "@/lib/settlement";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { sourceSignature } = await request.json();
    if (!sourceSignature) return Response.json({ error: "sourceSignature is required" }, { status: 400 });
    return Response.json(await settleFromSolana(id, sourceSignature));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Settlement failed";
    const clientError = [
      "sourceSignature is required",
      "Payment must be authorized before settlement",
      "Source Solana payment is not confirmed",
      "Source Solana transaction not found",
      "Source Solana mint or amount does not match payment",
    ].includes(message);
    return Response.json({ error: message }, { status: clientError ? 400 : 502 });
  }
}
