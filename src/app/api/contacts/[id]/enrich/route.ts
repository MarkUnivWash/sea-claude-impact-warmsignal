import type { NextRequest } from "next/server";
import { userDb } from "@/lib/auth";
import { enrichAndSave, type EnrichEvent } from "@/lib/enrich";

// Streams enrichment progress as Server-Sent Events: searches, sources as each search returns,
// Claude's partial output while it writes, then the final (identity-gated) result once saved.
// POST rather than GET: it writes to the database, and EventSource's auto-reconnect would re-run it.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Frame = EnrichEvent | { type: "saved" } | { type: "error"; message: string };

export async function POST(request: NextRequest, ctx: RouteContext<"/api/contacts/[id]/enrich">) {
  const { id } = await ctx.params;
  // Not requireCtx(): its redirect would hand the client an HTML page instead of a stream.
  const db = await userDb();
  const { data } = await db.auth.getClaims();
  const ownerId = data?.claims?.sub;
  if (!ownerId) return Response.json({ error: "Not signed in" }, { status: 401 });

  const { count } = await db
    .from("contacts")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("id", id);
  if (!count) return Response.json({ error: "Contact not found" }, { status: 404 });

  const encoder = new TextEncoder();
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const write = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          open = false;
        }
      };
      const send = (frame: Frame) => write(`data: ${JSON.stringify(frame)}\n\n`);
      // Padding comment flushes intermediary buffers; keep-alives stop idle proxies closing the stream.
      write(`: ${" ".repeat(2048)}\n\n`);
      const keepAlive = setInterval(() => write(": keep-alive\n\n"), 15000);

      // Claude emits many tiny deltas; forward at most one partial snapshot per ~80ms.
      let pending: unknown = null;
      let lastPartial = 0;
      const flushPartial = () => {
        if (pending != null) send({ type: "partial", data: pending });
        pending = null;
        lastPartial = Date.now();
      };

      try {
        await enrichAndSave({ db, ownerId }, id, {
          signal: abort.signal,
          onEvent: (e) => {
            if (e.type === "partial") {
              pending = e.data;
              if (Date.now() - lastPartial > 80) flushPartial();
              return;
            }
            flushPartial();
            send(e);
          },
        });
        send({ type: "saved" });
      } catch (e) {
        if (!abort.signal.aborted) {
          console.error(`Enrichment failed for ${id}:`, e);
          send({ type: "error", message: e instanceof Error ? e.message : "Enrichment failed" });
        }
      } finally {
        clearInterval(keepAlive);
        if (open) controller.close();
        open = false;
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
