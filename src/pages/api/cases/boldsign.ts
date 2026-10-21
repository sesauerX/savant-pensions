// BoldSign document events. Unknown documents (other uses of the same BoldSign account) are ignored.
import type { APIRoute } from "astro";
import { verifyWebhook } from "../../../lib/cases/boldsign";
import { config } from "../../../lib/cases/config";
import { notFound } from "../../../lib/cases/http";
import { readJson } from "../../../lib/cases/store";
import { completeSigning, refreshSignature } from "../../../lib/cases/workflow";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!config.enabled()) return notFound();
  const event = request.headers.get("x-boldsign-event") ?? "";
  if (event === "Verification") return new Response("OK");
  const secret = config.boldsignWebhookSecret();
  if (!secret) return new Response("Webhook not configured", { status: 503 });
  const raw = await request.text();
  if (!verifyWebhook(raw, request.headers.get("x-boldsign-signature"), secret)) return new Response("Invalid signature", { status: 401 });
  let payload: { data?: { documentId?: string } };
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const documentId = String(payload.data?.documentId ?? "");
  const link = documentId ? (await readJson<{ caseId: string }>(`boldsign/doc-${documentId.replace(/[^\w-]/g, "")}.json`))?.data : null;
  if (!link) return Response.json({ ignored: true });
  try {
    if (event === "Completed") await completeSigning(link.caseId, "BoldSign webhook");
    else await refreshSignature(link.caseId, "BoldSign webhook");
    console.log(`[cases] boldsign ${event} for ${link.caseId}`);
    return Response.json({ ok: true });
  } catch (err) {
    console.error(`[cases] boldsign ${event} for ${link.caseId} failed:`, (err as Error).message);
    return new Response("Processing failed", { status: 500 });
  }
};
