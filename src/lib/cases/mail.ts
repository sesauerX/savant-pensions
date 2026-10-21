// Resend: client emails (with test-mode redirect), admin notifications, login codes,
// and fetching inbound emails/attachments.
import { config } from "./config";
import { escapeHtml } from "./templates/render";

const API = "https://api.resend.com";
const MAX_TOTAL_B64 = 38 * 1024 * 1024; // Resend allows 40 MB after encoding; keep headroom.

async function resend(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${config.resendKey()}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${path.split("?")[0]} failed: ${res.status} ${(body as { message?: string }).message ?? ""}`.trim());
  return body as Record<string, unknown>;
}

export type Attachment = { filename: string; bytes: Uint8Array };

export type SentEmail = { ids: string[]; to: string[]; redirectedFrom?: string[]; parts: number };

const FOOTER_TEXT_NO_REPLY = "This mailbox is not monitored. Please contact us through sterlingpensiongroup.com/contact.";

function layout(bodyHtml: string, banner?: string) {
  const footer = config.replyTo() ? "Sterling Pension Group LLC · 15 N Main St #100, West Hartford, CT 06107, USA" : FOOTER_TEXT_NO_REPLY;
  return `<!doctype html><html><body style="margin:0;background:#F3F6FA;font-family:Helvetica,Arial,sans-serif;color:#1F2D3D">
${banner ? `<div style="background:#B42318;color:#fff;padding:10px 16px;font-size:13px;font-weight:bold">${escapeHtml(banner)}</div>` : ""}
<div style="max-width:620px;margin:0 auto;padding:24px 16px">
<div style="background:#fff;border:1px solid #DCE3EC;border-radius:8px;padding:28px">
<div style="font-weight:800;color:#0B2545;font-size:15px;letter-spacing:.08em;border-bottom:3px solid #F2B33D;display:inline-block;padding-bottom:4px;margin-bottom:20px">STERLING PENSION GROUP</div>
<div style="font-size:15px;line-height:1.55">${bodyHtml}</div>
</div>
<p style="font-size:12px;color:#5B6776;line-height:1.5;margin:16px 4px">${escapeHtml(footer)}</p>
</div></body></html>`;
}

function textLayout(text: string, banner?: string) {
  const footer = config.replyTo() ? "" : `\n\n--\n${FOOTER_TEXT_NO_REPLY}`;
  return `${banner ? `${banner}\n\n` : ""}${text}${footer}`;
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const b64Size = (bytes: Uint8Array) => Math.ceil(bytes.byteLength / 3) * 4;

/** Split attachments into groups that each fit Resend's size limit. */
function splitAttachments(atts: Attachment[]) {
  const groups: Attachment[][] = [[]];
  let size = 0;
  for (const a of atts) {
    const s = b64Size(a.bytes);
    if (s > MAX_TOTAL_B64) throw new Error(`Attachment ${a.filename} is too large to email`);
    if (size + s > MAX_TOTAL_B64 && groups[groups.length - 1].length) {
      groups.push([]);
      size = 0;
    }
    groups[groups.length - 1].push(a);
    size += s;
  }
  return groups;
}

/**
 * Send an email. Client-facing emails are redirected to TEST_RECIPIENT unless LIVE_MODE=true,
 * with a banner naming the original recipients.
 */
export async function sendEmail(opts: {
  to: string[];
  subject: string;
  html: string;
  text: string;
  attachments?: Attachment[];
  clientFacing: boolean;
}): Promise<SentEmail> {
  let to = opts.to.filter(Boolean);
  let banner: string | undefined;
  let redirectedFrom: string[] | undefined;
  if (opts.clientFacing && !config.live()) {
    const test = config.testRecipient();
    if (!test) throw new Error("TEST_RECIPIENT is not set (test mode)");
    redirectedFrom = to;
    to = [test];
    banner = `TEST – would have been sent to ${redirectedFrom.join(", ")}`;
  }
  if (!to.length) throw new Error("No recipients");
  const groups = opts.attachments?.length ? splitAttachments(opts.attachments) : [[]];
  const ids: string[] = [];
  for (let i = 0; i < groups.length; i++) {
    const suffix = groups.length > 1 ? ` (part ${i + 1} of ${groups.length})` : "";
    const res = await resend("/emails", {
      method: "POST",
      body: JSON.stringify({
        from: config.clientFrom(),
        to,
        ...(opts.clientFacing && config.bcc() ? { bcc: [config.bcc()] } : {}),
        ...(opts.clientFacing && config.replyTo() ? { reply_to: config.replyTo() } : {}),
        subject: opts.subject + suffix,
        html: layout(opts.html, banner),
        text: textLayout(opts.text, banner),
        ...(groups[i].length ? { attachments: groups[i].map((a) => ({ filename: a.filename, content: b64(a.bytes) })) } : {}),
      }),
    });
    ids.push(String(res.id ?? ""));
  }
  return { ids, to, redirectedFrom, parts: groups.length };
}

/** Admin notification: reference, company and a link only. Never client data. */
export async function notifyAdmins(subject: string, lines: string[], link?: string) {
  const to = config.adminNotifyTo();
  if (!to.length || !config.resendKey()) return false;
  const text = [...lines, ...(link ? ["", link] : [])].join("\n");
  const html = lines.map((l) => `<p style="margin:0 0 10px">${escapeHtml(l)}</p>`).join("") +
    (link ? `<p style="margin:16px 0 0"><a href="${escapeHtml(link)}" style="color:#13467A;font-weight:bold">Open in admin</a></p>` : "");
  try {
    await sendEmail({ to, subject, html, text, clientFacing: false });
    return true;
  } catch (err) {
    console.error("[cases] admin notification failed", (err as Error).message);
    return false;
  }
}

export async function sendLoginCode(to: string, code: string) {
  const text = `Your Sterling admin sign-in code is ${code}.\n\nIt expires in 10 minutes. If you did not ask for it, ignore this email.`;
  const html = `<p>Your Sterling admin sign-in code is</p><p style="font-size:30px;font-weight:800;letter-spacing:.2em;color:#0B2545;margin:8px 0 16px">${code}</p><p>It expires in 10 minutes. If you did not ask for it, ignore this email.</p>`;
  try {
    await sendEmail({ to: [to], subject: "Your Sterling admin sign-in code", html, text, clientFacing: false });
    return true;
  } catch (err) {
    console.error("[cases] login code email failed", (err as Error).message);
    return false;
  }
}

// ---- Inbound (Resend receiving)

export type ReceivedEmail = {
  id: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  created_at: string;
  text?: string | null;
  html?: string | null;
  headers?: Record<string, string>;
  reply_to?: string[];
  authentication?: unknown;
  attachments?: { id: string; filename: string; content_type: string; size?: number }[];
};

export async function getReceivedEmail(id: string): Promise<ReceivedEmail> {
  const e = (await resend(`/emails/receiving/${encodeURIComponent(id)}`)) as unknown as ReceivedEmail & { raw?: unknown };
  delete e.raw;
  return e;
}

export async function downloadReceivedAttachments(id: string) {
  const res = await resend(`/emails/receiving/${encodeURIComponent(id)}/attachments`);
  const items = (res.data ?? []) as { id: string; filename: string; content_type: string; size: number; download_url: string }[];
  const out: { filename: string; contentType: string; bytes: Uint8Array }[] = [];
  for (const a of items) {
    if (a.size > 40 * 1024 * 1024) continue;
    const r = await fetch(a.download_url);
    if (!r.ok) throw new Error(`Attachment download failed: ${r.status}`);
    out.push({ filename: a.filename || "attachment", contentType: a.content_type || "application/octet-stream", bytes: new Uint8Array(await r.arrayBuffer()) });
  }
  return out;
}

/** Bare address from "Name <a@b.c>". */
export function bareAddress(value: string) {
  const m = /<([^>]+)>/.exec(value);
  return (m ? m[1] : value).trim().toLowerCase();
}
