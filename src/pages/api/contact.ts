import type { APIRoute } from "astro";
import { EMAIL_RE, clean, configured, looksLikeSpam, sendAdminEmail, sourcePage } from "../../lib/notify";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Send a name, email, and message." }, { status: 400 });
  }

  if (looksLikeSpam(payload)) {
    return Response.json({ ok: true });
  }

  const name = clean(payload.name, 200);
  const email = clean(payload.email, 254);
  const phone = clean(payload.phone, 40);
  const message = String(payload.message ?? "").replace(/\r\n/g, "\n").trim();

  if (
    name.length < 2 ||
    name.length > 120 ||
    !EMAIL_RE.test(email) ||
    message.length > 5000 ||
    (phone && !/^[0-9+().\-\s]{0,40}$/.test(phone))
  ) {
    return Response.json({ ok: false, error: "Check the name and email, then try again." }, { status: 400 });
  }

  if (!configured()) {
    return Response.json({ ok: false, error: "The notification service is not configured yet." }, { status: 503 });
  }

  const sent = await sendAdminEmail({
    subject: "New contact enquiry – Sterling Pension Group",
    fields: [
      ["Name", name],
      ["Email", email],
      ["Phone", phone],
      ["Message", message ? `\n${message}` : ""],
    ],
    page: sourcePage(payload, request),
    replyTo: email,
  });

  if (!sent) {
    return Response.json(
      { ok: false, error: "We could not send that just now. Call +1 (860) 590-7172 or email info@savantpensions.com." },
      { status: 502 },
    );
  }

  return Response.json({ ok: true });
};
