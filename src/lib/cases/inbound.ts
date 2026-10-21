// Resend inbound processing (spec §7): verify, dedupe, route to a new case, an existing
// case, or the unassigned inbox.
import { createHmac } from "node:crypto";
import { config } from "./config";
import { addEvent, createCase, getCase, mutateCase, nowIso, randomId, REF_RE, setMilestone, storeFile } from "./cases";
import { applyDefaults } from "./derive";
import { extractFields } from "./extract";
import { safeEqual } from "./http";
import { bareAddress, downloadReceivedAttachments, getReceivedEmail, notifyAdmins, type ReceivedEmail } from "./mail";
import { putFile, readJson, updateJson, writeJson } from "./store";
import type { Case, CaseFile } from "./types";

// ---- Svix signature (Resend webhooks)
export function verifySvix(rawBody: string, headers: Headers, secret: string, toleranceSec = 300) {
  const id = headers.get("svix-id");
  const ts = headers.get("svix-timestamp");
  const sigs = headers.get("svix-signature");
  if (!id || !ts || !sigs || !secret.startsWith("whsec_")) return false;
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest("base64");
  return sigs
    .split(" ")
    .map((s) => s.split(","))
    .some(([v, sig]) => v === "v1" && typeof sig === "string" && safeEqual(sig, expected));
}

// ---- Unassigned inbox
export type InboxItem = {
  emailId: string;
  from: string;
  subject: string;
  receivedAt: string;
  reason: string;
  files: { id: string; name: string; path: string; size: number; contentType: string }[];
  status: "open" | "converted" | "attached" | "dismissed";
  caseId?: string;
  handledBy?: string;
};

const INBOX = "inbox/index.json";

export async function listInbox() {
  return (await readJson<InboxItem[]>(INBOX))?.data ?? [];
}

export async function getInboxEmail(emailId: string) {
  return (await readJson<StoredEmail>(`inbox/${safeId(emailId)}/email.json`))?.data ?? null;
}

export async function updateInboxItem(emailId: string, patch: Partial<InboxItem>) {
  await updateJson<InboxItem[]>(INBOX, (list) => list.map((i) => (i.emailId === emailId ? { ...i, ...patch } : i)), () => []);
}

type StoredEmail = Pick<ReceivedEmail, "id" | "from" | "to" | "cc" | "subject" | "created_at" | "text" | "html" | "headers" | "reply_to"> & {
  authentication?: unknown;
  attachments?: { filename: string; contentType: string; size: number }[];
};

const safeId = (id: string) => id.replace(/[^\w-]/g, "").slice(0, 80);

function storedEmail(e: ReceivedEmail, atts: { filename: string; contentType: string; bytes: Uint8Array }[]): StoredEmail {
  return {
    id: e.id,
    from: e.from,
    to: e.to,
    cc: e.cc,
    subject: e.subject,
    created_at: e.created_at,
    text: e.text ?? "",
    html: e.html ?? "",
    headers: e.headers,
    reply_to: e.reply_to,
    authentication: e.authentication,
    attachments: atts.map((a) => ({ filename: a.filename, contentType: a.contentType, size: a.bytes.byteLength })),
  };
}

function senderAllowed(e: ReceivedEmail) {
  const from = bareAddress(e.from);
  const domain = from.split("@")[1] ?? "";
  const listed = config.allowedSenders().some((s) => (s.startsWith("@") ? domain === s.slice(1) : from === s));
  const auth = (e.authentication ?? {}) as { dmarc?: string };
  // Require DMARC pass so a forged From header cannot open a case.
  return { listed, authenticated: auth.dmarc === "pass", from };
}

function addressedToUs(e: ReceivedEmail & { received_for?: string[] }) {
  const target = config.inboundAddress();
  if (!target) return false;
  const all = [...(e.to ?? []), ...(e.cc ?? []), ...(e.received_for ?? [])].map(bareAddress);
  return all.includes(target);
}

export function findReference(e: Pick<ReceivedEmail, "subject" | "text">) {
  return (REF_RE.exec(e.subject ?? "") ?? REF_RE.exec(e.text ?? ""))?.[0] ?? null;
}

const MAX_ATTACH = 25 * 1024 * 1024;

async function toInbox(e: ReceivedEmail, atts: { filename: string; contentType: string; bytes: Uint8Array }[], reason: string) {
  const base = `inbox/${safeId(e.id)}`;
  await writeJson(`${base}/email.json`, storedEmail(e, atts));
  const files: InboxItem["files"] = [];
  for (const a of atts) {
    if (a.bytes.byteLength > MAX_ATTACH) continue;
    const id = randomId();
    const path = `${base}/files/${id}`;
    await putFile(path, a.bytes, a.contentType);
    files.push({ id, name: a.filename, path, size: a.bytes.byteLength, contentType: a.contentType });
  }
  const item: InboxItem = { emailId: e.id, from: bareAddress(e.from), subject: e.subject ?? "", receivedAt: e.created_at, reason, files, status: "open" };
  await updateJson<InboxItem[]>(INBOX, (list) => [item, ...list.filter((i) => i.emailId !== e.id)].slice(0, 500), () => []);
  await notifyAdmins("Unassigned email in the Sterling case inbox", [`An email was placed in the unassigned inbox (${reason}).`], `${config.siteUrl()}/admin/inbox`);
}

/** Attach an email (body + attachments) to an existing case. */
export async function attachEmailToCase(
  c: Case,
  e: StoredEmail | ReceivedEmail,
  atts: { filename: string; contentType: string; bytes: Uint8Array }[],
  by: string,
) {
  await writeJson(`cases/${c.id}/inbound/${safeId(e.id)}.json`, storedEmail(e as ReceivedEmail, atts));
  const files: CaseFile[] = [];
  for (const a of atts) {
    if (a.bytes.byteLength > MAX_ATTACH) continue;
    files.push(await storeFile(c.id, { bytes: a.bytes, name: a.filename, kind: "inbound", contentType: a.contentType, by, inboundEmailId: e.id }));
  }
  return mutateCase(c.id, by, (cc) => {
    if (cc.inbound.some((i) => i.emailId === e.id)) return;
    cc.files.push(...files);
    cc.inbound.push({ emailId: e.id, from: bareAddress(e.from), subject: e.subject ?? "", receivedAt: e.created_at ?? nowIso(), fileIds: files.map((f) => f.id) });
    addEvent(cc, by, `Inbound email attached (${files.length} attachment${files.length === 1 ? "" : "s"})`);
  });
}

/** Run extraction and store the result on the case (also used by "Re-run extraction"). */
export async function runExtraction(caseId: string, email: { from: string; subject: string; text: string }, atts: { filename: string; contentType: string; bytes: Uint8Array }[], by: string) {
  try {
    const r = await extractFields(email, atts);
    return await mutateCase(caseId, by, (c) => {
      // Keep anything already typed in by a person; fill the rest.
      const merged = { ...r.fields, ...Object.fromEntries(Object.entries(c.fields).filter(([, v]) => v !== undefined && v !== "")) };
      c.fields = applyDefaults(merged);
      c.extraction = { model: r.model, at: nowIso(), notes: r.notes, missing: r.missing, uncertain: r.uncertain };
      addEvent(c, by, `Details extracted by ${r.model} (${Object.keys(r.fields).length} fields, ${r.uncertain.length} uncertain)`);
    });
  } catch (err) {
    console.error("[cases] extraction failed", caseId, (err as Error).message);
    return await mutateCase(caseId, by, (c) => {
      c.extraction = { model: config.anthropicModel(), at: nowIso(), notes: "", missing: [], uncertain: [], error: (err as Error).message.slice(0, 300) };
      addEvent(c, by, "Extraction failed; enter the details manually");
    });
  }
}

/** New intake from an email: create the case, store the email, extract, notify. */
export async function intakeEmail(e: StoredEmail | ReceivedEmail, atts: { filename: string; contentType: string; bytes: Uint8Array }[], by: string) {
  const c = await createCase(
    { source: { type: "email", from: bareAddress(e.from), subject: e.subject ?? "", receivedAt: e.created_at, resendEmailId: e.id } },
    by,
  );
  await attachEmailToCase(c, e, atts, by);
  await mutateCase(c.id, by, (cc) => {
    setMilestone(cc, "received", by);
  });
  const done = await runExtraction(c.id, { from: e.from, subject: e.subject ?? "", text: e.text || htmlToText(e.html ?? "") }, atts, by);
  const company = String(done.fields.company_name ?? "(company not found)");
  await notifyAdmins(`New case ${c.id} needs review`, [`New case ${c.id}: ${company}.`, "Review and confirm the details in the admin."], `${config.siteUrl()}/admin/cases/${c.id}`);
  return done;
}

export function htmlToText(html: string) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Process one `email.received` event. The body is always re-fetched from Resend by ID, so a
 * forged webhook cannot inject content. Idempotent per email id.
 */
export async function processInbound(emailId: string): Promise<string> {
  const id = safeId(emailId);
  if (!id) return "invalid";
  try {
    await writeJson(`inbound/seen/${id}.json`, { at: nowIso() }, { create: true });
  } catch {
    return "duplicate";
  }
  try {
    const e = (await getReceivedEmail(id)) as ReceivedEmail & { received_for?: string[] };
    const atts = await downloadReceivedAttachments(id);
    if (!addressedToUs(e)) {
      await toInbox(e, atts, "sent to another address");
      return "inbox:address";
    }
    const sender = senderAllowed(e);
    if (!sender.listed || !sender.authenticated) {
      await toInbox(e, atts, !sender.listed ? "sender not on the allowlist" : "sender not authenticated (DMARC)");
      return "inbox:sender";
    }
    const ref = findReference(e);
    if (ref) {
      const c = await getCase(ref);
      if (!c) {
        await toInbox(e, atts, `unknown reference ${ref}`);
        return "inbox:unknown-ref";
      }
      await attachEmailToCase(c, e, atts, `email:${sender.from}`);
      await notifyAdmins(`${c.id}: new email on the case`, [`An email was attached to case ${c.id} (${atts.length} attachment${atts.length === 1 ? "" : "s"}).`], `${config.siteUrl()}/admin/cases/${c.id}#inbox`);
      return `attached:${c.id}`;
    }
    const c = await intakeEmail(e, atts, `email:${sender.from}`);
    return `created:${c.id}`;
  } catch (err) {
    // Release the claim so Resend's retry can process it again.
    const { deleteFile } = await import("./store");
    await deleteFile(`inbound/seen/${id}.json`).catch(() => {});
    throw err;
  }
}
