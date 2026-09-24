import type { APIRoute } from "astro";

export const prerender = false;

const TO = (process.env.CONTACT_TO || "info@savantpensions.com")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

export const POST: APIRoute = async ({ request }) => {
  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Send a name, email, and message." }, { status: 400 });
  }

  if (typeof payload.company_website === "string" && payload.company_website.trim()) {
    return Response.json({ ok: true });
  }

  const name = String(payload.name ?? "").trim();
  const email = String(payload.email ?? "").trim();
  const phone = String(payload.phone ?? "").trim();
  const message = String(payload.message ?? "").trim();

  if (name.length < 2 || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || message.length > 5000) {
    return Response.json({ ok: false, error: "Check the name and email, then try again." }, { status: 400 });
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return Response.json({ ok: false, error: "The notification service is not configured yet." }, { status: 503 });
  }

  const text = [
    `Name: ${name}`,
    `Email: ${email}`,
    `Phone: ${phone || "not given"}`,
    "",
    message || "(no message)",
  ].join("\n");

  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Sterling Pension Group <notifications@sterlingpensiongroup.com>",
      to: TO,
      reply_to: email,
      subject: `Consultation request from ${name}`,
      text,
    }),
  });

  if (!sent.ok) {
    return Response.json(
      { ok: false, error: "We could not send that just now. Call +1 (860) 590-7172 or email info@savantpensions.com." },
      { status: 502 },
    );
  }

  return Response.json({ ok: true });
};
