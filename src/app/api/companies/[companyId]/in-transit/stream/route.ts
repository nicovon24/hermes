import { z } from "zod";
import { DEMO_COMPANIES, getBuyerCompanyId } from "@/lib/demo-workspace";
import { listBuyerInTransit } from "@/modules/protocol/services/buyer-inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const POLL_INTERVAL_MS = 2500;
const buyerIds = new Set<string>([
  getBuyerCompanyId(),
  ...DEMO_COMPANIES.filter((company) => company.kind === "BUYER").map((company) => company.id),
]);

/**
 * Server-sent events with what the shop has travelling: the units of every
 * purchase order whose payment confirmed. The database is polled on the
 * server and an `in-transit` event is emitted only when the totals changed,
 * so an open storefront moves a product to "En tránsito" seconds after the
 * payment is approved.
 */
export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  if (!z.uuid().safeParse(companyId).success || !buyerIds.has(companyId)) {
    return Response.json({ error: "Comercio inválido." }, { status: 400 });
  }
  let last: string;
  try {
    last = JSON.stringify(await listBuyerInTransit(companyId));
  } catch {
    return Response.json({ error: "No se pudo leer el stock en tránsito." }, { status: 502 });
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
      write(`retry: 3000\nevent: in-transit\ndata: ${last}\n\n`);
      timer = setInterval(async () => {
        if (closed) return;
        try {
          const snapshot = JSON.stringify(await listBuyerInTransit(companyId));
          if (snapshot !== last) { last = snapshot; write(`event: in-transit\ndata: ${snapshot}\n\n`); }
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
