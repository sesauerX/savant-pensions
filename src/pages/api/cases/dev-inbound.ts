// Local dev only: feed a synthetic inbound email through the real router (no Resend fetch).
import type { APIRoute } from "astro";
import { routeInbound } from "../../../lib/cases/inbound";
import { config } from "../../../lib/cases/config";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!import.meta.env.DEV) return new Response("Not found", { status: 404 });
  const b = (await request.json()) as {
    from: string;
    subject: string;
    text: string;
    dmarc?: string;
    attachments?: { filename: string; contentType: string; base64: string }[];
  };
  const id = `dev-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const result = await routeInbound(
    {
      id,
      from: b.from,
      to: [config.inboundAddress()],
      subject: b.subject,
      created_at: new Date().toISOString(),
      text: b.text,
      html: "",
      authentication: { spf: b.dmarc ?? "pass", dkim: b.dmarc ?? "pass", dmarc: b.dmarc ?? "pass" },
    },
    (b.attachments ?? []).map((a) => ({ filename: a.filename, contentType: a.contentType, bytes: new Uint8Array(Buffer.from(a.base64, "base64")) })),
  );
  return Response.json({ id, result });
};
