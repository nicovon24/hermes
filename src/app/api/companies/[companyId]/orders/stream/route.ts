import { z } from "zod";
import { DEMO_SUPPLIER_COMPANY_IDS } from "@/lib/demo-workspace";
import { listSupplierOrders } from "@/modules/protocol/services/supplier-orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const POLL_INTERVAL_MS = 2500;
const supplierIds = new Set<string>(DEMO_SUPPLIER_COMPANY_IDS);

/**
 * Server-sent events with the supplier's order book. The database is polled
 * on the server and a new `orders` event is emitted only when the snapshot
 * changed, so an open supplier page sees a new order or a payment update
 * within a couple of seconds without reloading.
 */
export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  if (!z.uuid().safeParse(companyId).success || !supplierIds.has(companyId)) {
    return Response.json({ error: "Distribuidor inválido." }, { status: 400 });
  }
  let last: string;
  try {
    last = JSON.stringify(await listSupplierOrders(companyId));
  } catch {
    return Response.json({ error: "No se pudieron leer los pedidos." }, { status: 502 });
  }

  const encoder = new TextEncoder();
  let closed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(chunk)); } catch { closed = true; }
      };
      const stop = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        try { controller.close(); } catch { /* already closed */ }
      };
      write(`retry: 3000\nevent: orders\ndata: ${last}\n\n`);
      timer = setInterval(async () => {
        if (closed) return;
        try {
          const snapshot = JSON.stringify(await listSupplierOrders(companyId));
          if (snapshot !== last) { last = snapshot; write(`event: orders\ndata: ${snapshot}\n\n`); }
          else write(`: ping\n\n`);
        } catch {
          // A transient database error keeps the connection open; the next tick retries.
          write(`: retry\n\n`);
        }
      }, POLL_INTERVAL_MS);
      request.signal.addEventListener("abort", stop);
    },
    cancel() {
      closed = true;
      if (timer) clearInterval(timer);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" },
  });
}
