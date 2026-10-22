// Resend inbound processing (spec §7): verify, dedupe, route to a new case, an existing
// case, or the unassigned inbox.
import { createHmac } from "node:crypto";
import { config } from "./config";
import { addEvent, createCase, getCase, mutateCase, nowIso, randomId, REF_RE, setMilestone, storeFile } from "./cases";
import { applyDefaults } from "./derive";
import { extractFields } from "./extract";
import { safeEqual } from "./http";
import { bareAddress, downloadReceivedAttachments, getReceivedEmail, notifyAdmins, type ReceivedEmail } from "./mail";
import { getFileBytes, putFile, readJson, updateJson, writeJson } from "./store";
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
    const f = await storeFile(c.id, { bytes: a.bytes, name: a.filename, kind: "inbound", contentType: a.contentType, by, inboundEmailId: e.id });
    // Suggest the identity tag at once (also for client replies, which are not extracted).
    if (looksLikeIdentityDocument(a.filename)) f.identitySuggested = true;
    files.push(f);
  }
  return mutateCase(c.id, by, (cc) => {
    if (cc.inbound.some((i) => i.emailId === e.id)) return;
    cc.files.push(...files);
    cc.inbound.push({ emailId: e.id, from: bareAddress(e.from), subject: e.subject ?? "", receivedAt: e.created_at ?? nowIso(), fileIds: files.map((f) => f.id) });
    addEvent(cc, by, `Inbound email attached (${files.length} attachment${files.length === 1 ? "" : "s"})`);
  });
}

/** Attachment names that look like passport or ID scans (suggestion only; an admin confirms). */
export function looksLikeIdentityDocument(name: string) {
  return /passport|reisepass|pass[-_ ]?(scan|kopie|copy)|ausweis|identity|identit[äa]t|id[-_ ]?card|carte[-_ ]d.?identit|national[-_ ]id|(^|[^a-z])id([^a-z]|$)/i.test(name);
}

/** Identifiers that look like placeholders (00-0000000, 1234567, 0000…): flag for review. */
export function looksLikePlaceholder(value: unknown) {
  const v = String(value ?? "");
  const digits = v.replace(/\D/g, "");
  if (digits.length < 5) return false;
  const zeros = digits.split("").filter((d) => d === "0").length;
  return /^(\d)\1+$/.test(digits) || zeros >= digits.length - 1 || "01234567890123456789".includes(digits) || "98765432109876543210".includes(digits);
}

/** All inbound emails of a case (oldest first) as one extraction input, plus their attachments. */
export async function caseEmailsForExtraction(c: Case) {
  const parts: string[] = [];
  const atts: { filename: string; contentType: string; bytes: Uint8Array }[] = [];
  const emails = [...c.inbound].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  let n = 0;
  for (const em of emails) {
    const raw = (await readJson<{ from?: string; subject?: string; created_at?: string; text?: string; html?: string }>(`cases/${c.id}/inbound/${safeId(em.emailId)}.json`))?.data;
    if (!raw) continue;
    n++;
    parts.push(`--- Email ${n} (${em.from === c.source.from ? "intake" : "follow-up"}) ---\nFrom: ${raw.from ?? em.from}\nDate: ${raw.created_at ?? em.receivedAt}\nSubject: ${raw.subject ?? em.subject}\n\n${raw.text || htmlToText(raw.html ?? "")}`);
    for (const id of em.fileIds) {
      const f = c.files.find((x) => x.id === id);
      if (!f || f.deleted) continue;
      const bytes = await getFileBytes(f.path);
      if (bytes) atts.push({ filename: f.name, contentType: f.contentType, bytes });
    }
  }
  const first = emails[0];
  return {
    email: { from: first?.from ?? "", subject: first?.subject ?? "", text: `The case has ${n} email(s) in date order. Later emails (for example the client's replies) add missing details.\n\n${parts.join("\n\n")}` },
    atts,
    count: n,
  };
}

/** German-speaking client by nationality or country of residence. */
export function suggestsGerman(fields: Record<string, unknown>) {
  const nat = String(fields.beneficiary_nationality ?? "").toLowerCase();
  const addr = `${String(fields.member_address ?? "")} ${String(fields.beneficiary_address ?? "")}`.toLowerCase();
  return /\b(german|austrian|swiss)\b/.test(nat) || /\b(germany|deutschland|austria|österreich|osterreich|switzerland|schweiz|suisse)\b/.test(addr);
}

/** Run extraction and store the result on the case (also used by "Re-run extraction"). */
export async function runExtraction(caseId: string, email: { from: string; subject: string; text: string }, atts: { filename: string; contentType: string; bytes: Uint8Array }[], by: string) {
  try {
    const r = await extractFields(email, atts);
    return await mutateCase(caseId, by, (c) => {
      // Keep anything already typed in by a person; fill the rest.
      const merged = { ...r.fields, ...Object.fromEntries(Object.entries(c.fields).filter(([, v]) => v !== undefined && v !== "")) };
      c.fields = applyDefaults(merged);
      const uncertain = [...r.uncertain];
      // German emails for German, Austrian or Swiss clients; Pocholo confirms (flagged uncertain).
      if (!c.milestones.details_confirmed && suggestsGerman(c.fields)) {
        c.fields.client_language = "de";
        if (!uncertain.includes("client_language")) uncertain.push("client_language");
      }
      // Placeholder-looking identifiers are always flagged, whatever the model said.
      for (const k of ["ein", "state_filing_id", "beneficiary_passport"]) {
        if (c.fields[k] && looksLikePlaceholder(c.fields[k]) && !uncertain.includes(k)) uncertain.push(k);
      }
      if (typeof c.fields.ein === "string" && /^00-/.test(c.fields.ein) && !uncertain.includes("ein")) uncertain.push("ein");
      c.extraction = { model: r.model, at: nowIso(), notes: r.notes, missing: r.missing, uncertain };
      const suggested = new Set(r.identityDocuments.map((n) => n.trim().toLowerCase()));
      let tagged = 0;
      for (const f of c.files) {
        if (f.kind === "inbound" && !f.identity && !f.deleted && (suggested.has(f.name.trim().toLowerCase()) || looksLikeIdentityDocument(f.name))) {
          f.identitySuggested = true;
          tagged++;
        }
      }
      if (tagged) addEvent(c, by, `Extraction suggests ${tagged} attachment(s) are identity documents; confirm with “File as… Identity document”`);
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
 * Decide where an inbound email goes:
 * - a reply from the case's client (sender = member_email, DMARC pass, valid reference) → that case;
 * - allowlisted, authenticated senders → the referenced case, or a new intake without a reference;
 * - everything else → the unassigned inbox.
 */
export async function routeInbound(
  e: ReceivedEmail & { received_for?: string[] },
  atts: { filename: string; contentType: string; bytes: Uint8Array }[],
): Promise<string> {
  if (!addressedToUs(e)) {
    await toInbox(e, atts, "sent to another address");
    return "inbox:address";
  }
  const sender = senderAllowed(e);
  const ref = findReference(e);
  const c = ref ? await getCase(ref) : null;
  const clientEmail = String(c?.fields.member_email ?? "").trim().toLowerCase();
  if (c && sender.authenticated && clientEmail && sender.from === clientEmail) {
    await attachEmailToCase(c, e, atts, `client:${sender.from}`);
    await notifyAdmins(`${c.id}: the client replied`, [`The client replied on case ${c.id} (${atts.length} attachment${atts.length === 1 ? "" : "s"}).`], `${config.siteUrl()}/admin/cases/${c.id}#inbox`);
    return `client-reply:${c.id}`;
  }
  if (!sender.listed || !sender.authenticated) {
    await toInbox(e, atts, !sender.authenticated ? "sender not authenticated (DMARC)" : ref ? "sender is neither on the allowlist nor the case's client" : "sender not on the allowlist");
    return "inbox:sender";
  }
  if (ref) {
    if (!c) {
      await toInbox(e, atts, `unknown reference ${ref}`);
      return "inbox:unknown-ref";
    }
    await attachEmailToCase(c, e, atts, `email:${sender.from}`);
    await notifyAdmins(`${c.id}: new email on the case`, [`An email was attached to case ${c.id} (${atts.length} attachment${atts.length === 1 ? "" : "s"}).`], `${config.siteUrl()}/admin/cases/${c.id}#inbox`);
    return `attached:${c.id}`;
  }
  const created = await intakeEmail(e, atts, `email:${sender.from}`);
  return `created:${created.id}`;
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
    return await routeInbound(e, atts);
  } catch (err) {
    // Release the claim so Resend's retry can process it again.
    const { deleteFile } = await import("./store");
    await deleteFile(`inbound/seen/${id}.json`).catch(() => {});
    throw err;
  }
}
