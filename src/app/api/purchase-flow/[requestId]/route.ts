import { z } from "zod";
import { getBuyerCompanyId } from "@/lib/demo-workspace";
import { DomainError } from "@/lib/domain/errors";
import { getTenderSnapshot } from "@/modules/protocol/services/tender-snapshot";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  if (!z.uuid().safeParse(requestId).success) return Response.json({ message: "Pedido inválido." }, { status: 400 });
  try { return Response.json(await getTenderSnapshot(requestId, getBuyerCompanyId()), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ message: "No se pudo leer el pedido." }, { status: error instanceof DomainError ? error.status : 500 }); }
}
