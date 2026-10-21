// Resend `email.received` webhook (Svix-signed). The body is re-fetched from Resend by id.
import type { APIRoute } from "astro";
import { config } from "../../../lib/cases/config";
import { processInbound, verifySvix } from "../../../lib/cases/inbound";
import { notFound } from "../../../lib/cases/http";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!config.enabled()) return notFound();
  const secret = config.resendWebhookSecret();
  if (!secret) return new Response("Webhook not configured", { status: 503 });
  const raw = await request.text();
  if (!verifySvix(raw, request.headers, secret)) return new Response("Invalid signature", { status: 401 });
  let payload: { type?: string; data?: { email_id?: string } };
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  if (payload.type !== "email.received") return Response.json({ ignored: payload.type ?? "unknown" });
  const emailId = String(payload.data?.email_id ?? "");
  if (!emailId) return new Response("Missing email_id", { status: 400 });
  try {
    const result = await processInbound(emailId);
    console.log(`[cases] inbound ${emailId}: ${result}`);
    return Response.json({ ok: true, result: result.split(":")[0] });
  } catch (err) {
    console.error(`[cases] inbound ${emailId} failed:`, (err as Error).message);
    return new Response("Processing failed", { status: 500 });
  }
};
