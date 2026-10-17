// Admin notifications through Resend, shared by the form endpoints.
// Configuration comes from the existing project env vars:
// RESEND_API_KEY, CONTACT_TO (comma-separated) and CONTACT_FROM.

const TO = (process.env.CONTACT_TO || "sesauer@gmail.com")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const FROM = process.env.CONTACT_FROM || "Sterling Pension Group <onboarding@resend.dev>";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Submissions faster than this after the page rendered are treated as bots.
const MIN_FILL_MS = 2500;

export type Field = [label: string, value: string];

/** One line of text, no control characters, capped. */
export function clean(value: unknown, max: number) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

/**
 * Honeypot and timing checks. A bot gets the same `{ ok: true }` a person
 * would, so it learns nothing.
 */
export function looksLikeSpam(payload: Record<string, unknown>) {
  if (typeof payload.company_website === "string" && payload.company_website.trim()) return true;
  const started = Number(payload.form_started);
  if (Number.isFinite(started) && started > 0 && Date.now() - started < MIN_FILL_MS) return true;
  return false;
}

/** Page the form was sent from: the `page` field if it is on this site, else the Referer. */
export function sourcePage(payload: Record<string, unknown>, request: Request) {
  const site = new URL(request.url).origin;
  const candidates = [clean(payload.page, 300), request.headers.get("referer") ?? ""];
  for (const value of candidates) {
    try {
      const url = new URL(value, site);
      if (url.origin === site) return url.href;
    } catch {}
  }
  return "unknown";
}

export function configured() {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendAdminEmail(opts: {
  subject: string;
  fields: Field[];
  page: string;
  replyTo?: string;
  note?: string;
}) {
  const timestamp = new Date();
  const eastern = timestamp.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "long" });
  const width = Math.max(...opts.fields.map(([label]) => label.length));
  const text = [
    ...opts.fields.map(([label, value]) => `${(label + ":").padEnd(width + 2)}${value || "not given"}`),
    "",
    `Page:      ${opts.page}`,
    `Submitted: ${eastern} (${timestamp.toISOString()})`,
    ...(opts.note ? ["", opts.note] : []),
  ].join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: TO,
      ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
      subject: opts.subject,
      text,
    }),
  });
  return res.ok;
}
