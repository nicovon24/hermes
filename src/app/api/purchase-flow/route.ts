import { after } from "next/server";
import { z } from "zod";
import { getBuyerCompanyId } from "@/lib/demo-workspace";
import { DomainError } from "@/lib/domain/errors";
import { launchPurchaseFlowSchema, type TenderProgressEvent } from "@/modules/protocol/domain/purchase-flow";
import { launchPurchaseFlow } from "@/modules/protocol/services/purchase-flow";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  let sameOrigin = false;
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    const target = new URL(request.url);
    sameOrigin = origin.host === (request.headers.get("host") ?? target.host) && origin.protocol === target.protocol;
  } catch { /* Missing or malformed Origin is rejected. */ }
  if (!sameOrigin || !request.headers.get("content-type")?.includes("application/json")) {
    return Response.json({ message: "Origen de solicitud inválido." }, { status: 403 });
  }
  let input;
  try {
    input = launchPurchaseFlowSchema.parse(await request.json());
    if (input.buyerCompanyId !== getBuyerCompanyId()) throw new DomainError("Comprador inválido.", "FORBIDDEN", 403);
  } catch (error) {
    return Response.json({ message: error instanceof z.ZodError ? "Revisá los datos y vencimientos del pedido." : "Solicitud inválida." }, { status: error instanceof DomainError ? error.status : 400 });
  }
  const encoder = new TextEncoder();
  let closed = false;
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel() { closed = true; } });
  // Flush the response before database setup begins. The padding also clears
  // WebKit's small-response buffering threshold, so the client can display its
  // connection state immediately while durable progress is being prepared.
  controller.enqueue(encoder.encode(`${JSON.stringify({
    type: "connected",
    requestId: input.requestId,
    padding: " ".repeat(1024),
  })}\n`));
  const emit = (event: TenderProgressEvent) => {
    if (!closed) { try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); } catch { closed = true; } }
  };
  const work = launchPurchaseFlow(input, emit).catch((error) => {
    // Transport failures are not persisted progress events and must not advance the scene.
    if (!closed) {
      try { controller.enqueue(encoder.encode(`${JSON.stringify({ type: "transport_error", message: error instanceof DomainError ? error.message : "No se pudo iniciar el pedido. Revisá su estado antes de volver a enviarlo." })}\n`)); }
      catch { closed = true; }
    }
  }).finally(() => { if (!closed) { closed = true; controller.close(); } });
  // Keep the already-authorized work alive if the browser leaves the stream.
  after(() => work);
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
}
