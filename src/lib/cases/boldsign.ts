// BoldSign: send the 3 corporate documents in one envelope, poll status, download and
// split the signed result, and verify webhooks.
import { createHmac } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { config } from "./config";
import { safeEqual } from "./http";
import type { DocKey } from "./types";
import type { FieldMarker } from "./pdf";

const API = "https://api.boldsign.com";

/** Documents sent on behalf of a sender identity need `onBehalfOf` on later calls too. */
const behalf = () => (config.boldsignSenderEmail() ? `&onBehalfOf=${encodeURIComponent(config.boldsignSenderEmail())}` : "");

async function bs(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { "X-API-KEY": config.boldsignKey(), ...(init.headers ?? {}) } });
  return res;
}

async function bsJson(path: string, init: RequestInit = {}) {
  const res = await bs(path, init);
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {}
  if (!res.ok) throw new Error(`BoldSign ${path.split("?")[0]} failed: ${res.status} ${String(body.error ?? body.message ?? text).slice(0, 300)}`);
  return body;
}

type Tag = { id: string; type: "Signature" | "DateSigned"; signer: number };

/**
 * Main envelope (OA, Policy, Consent, Award Letter, Certificate C1). Signer 1 = client (member),
 * 2 = Sterling (Pocholo). The Award Letter and C1 are signed by Sterling only. The ids match the
 * .sigbox markers in the templates.
 */
export const MAIN_TAGS: Tag[] = [
  { id: "client_sig_oa", type: "Signature", signer: 1 },
  { id: "client_date_oa", type: "DateSigned", signer: 1 },
  { id: "spg_sig_oa", type: "Signature", signer: 2 },
  { id: "spg_sig_policy", type: "Signature", signer: 2 },
  { id: "client_sig_consent", type: "Signature", signer: 1 },
  { id: "spg_sig_consent", type: "Signature", signer: 2 },
  { id: "spg_sig_award", type: "Signature", signer: 2 },
  { id: "spg_sig_cert", type: "Signature", signer: 2 },
];

/** Later certificate issues: one document, Sterling is the only signer. */
export const CERT_ONLY_TAGS: Tag[] = [{ id: "spg_sig_cert", type: "Signature", signer: 1 }];

export type SendInput = {
  title: string;
  message: string;
  /** Each file with the signature markers found while rendering it (see pdf.ts). */
  files: { name: string; bytes: Uint8Array; pages: number; fields: FieldMarker[] }[];
  /** In signing order. */
  signers: { name: string; email: string }[];
  tags: Tag[];
};

/** BoldSign bounds are pixels at 96 dpi from the top-left of the page; PDF markers are points from the bottom-left. */
const PX = 96 / 72;

/** Signature fields placed by coordinates (no text tags, so nothing is left in the PDF text layer). */
export function placeFields(files: SendInput["files"], tags: Tag[]) {
  const placed: (Tag & { page: number; x: number; y: number; width: number; height: number })[] = [];
  let offset = 0;
  for (const f of files) {
    for (const m of f.fields) {
      const tag = tags.find((t) => t.id === m.id);
      if (!tag) continue;
      placed.push({
        ...tag,
        page: offset + m.page + 1, // 1-based, counted across all files of the envelope
        x: Math.round(m.x * PX),
        y: Math.round((m.pageHeight - m.y - m.height) * PX),
        width: Math.round(m.width * PX),
        height: Math.round(m.height * PX),
      });
    }
    offset += f.pages;
  }
  const missing = tags.filter((t) => placed.filter((p) => p.id === t.id).length !== 1).map((t) => t.id);
  if (missing.length) throw new Error(`Signature positions not found exactly once: ${missing.join(", ")}`);
  return placed;
}

// BoldSign's own emails: keep the signing request, reminders and problem notices; no "completed"
// email with the combined PDF (the client gets our email A instead).
const RECIPIENT_NOTIFICATIONS: Record<string, boolean> = {
  SignatureRequest: true,
  Declined: true,
  Revoked: true,
  Signed: true,
  Completed: false,
  Expired: true,
  Reassigned: true,
  Deleted: true,
  Reminders: true,
  EditRecipient: true,
  EditDocument: true,
};

export async function sendEnvelope(input: SendInput): Promise<string> {
  const form = new FormData();
  form.set("Title", input.title);
  form.set("Message", input.message);
  form.set("EnableSigningOrder", input.signers.length > 1 ? "true" : "false");
  form.set("ExpiryDays", "30");
  form.set("ReminderSettings.EnableAutoReminder", "true");
  form.set("ReminderSettings.ReminderDays", "3");
  form.set("ReminderSettings.ReminderCount", "5");
  form.set("HideDocumentId", "false");
  if (config.boldsignBrandId()) form.set("BrandId", config.boldsignBrandId());
  if (config.boldsignSenderEmail()) form.set("OnBehalfOf", config.boldsignSenderEmail());
  // Local smoke tests only: create the envelope without emailing anyone.
  if (process.env.BOLDSIGN_DISABLE_EMAILS === "true") form.set("DisableEmails", "true");
  const fields = placeFields(input.files, input.tags);
  input.signers.forEach((s, i) => {
    form.set(`Signers[${i}][Name]`, s.name);
    form.set(`Signers[${i}][EmailAddress]`, s.email);
    form.set(`Signers[${i}][SignerOrder]`, String(i + 1));
    form.set(`Signers[${i}][SignerType]`, "Signer");
    for (const [k, v] of Object.entries(RECIPIENT_NOTIFICATIONS)) form.set(`Signers[${i}][RecipientNotificationSettings][${k}]`, String(v));
    fields
      .filter((f) => f.signer === i + 1)
      .forEach((f, j) => {
        const key = `Signers[${i}][FormFields][${j}]`;
        form.set(`${key}[Id]`, f.id);
        form.set(`${key}[FieldType]`, f.type);
        form.set(`${key}[PageNumber]`, String(f.page));
        form.set(`${key}[IsRequired]`, "true");
        form.set(`${key}[Bounds][X]`, String(f.x));
        form.set(`${key}[Bounds][Y]`, String(f.y));
        form.set(`${key}[Bounds][Width]`, String(f.width));
        form.set(`${key}[Bounds][Height]`, String(f.height));
      });
  });
  for (const f of input.files) {
    form.append("Files", new Blob([f.bytes as BlobPart], { type: "application/pdf" }), f.name);
  }
  const body = await bsJson("/v1/document/send", { method: "POST", body: form });
  const id = String(body.documentId ?? "");
  if (!id) throw new Error("BoldSign did not return a documentId");
  return id;
}

export type EnvelopeStatus = {
  status: string; // InProgress, Completed, Declined, Expired, Revoked, ...
  signers: { name: string; email: string; status: string; order: number }[];
  pageCounts: number[];
  combinedAudit: boolean;
};

export async function getStatus(documentId: string): Promise<EnvelopeStatus> {
  const d = await bsJson(`/v1/document/properties?documentId=${encodeURIComponent(documentId)}${behalf()}`);
  const signers = ((d.signerDetails as Record<string, unknown>[]) ?? []).map((s, i) => ({
    name: String(s.signerName ?? ""),
    email: String(s.signerEmail ?? ""),
    status: String(s.status ?? ""),
    order: Number(s.order ?? i + 1),
  }));
  const pageCounts = ((d.files as { pageCount?: number }[]) ?? []).map((f) => Number(f.pageCount ?? 0));
  return { status: String(d.status ?? ""), signers, pageCounts, combinedAudit: d.isCombinedAudit === true };
}

export async function downloadSigned(documentId: string) {
  const res = await bs(`/v1/document/download?documentId=${encodeURIComponent(documentId)}${behalf()}`);
  if (!res.ok) throw new Error(`BoldSign download failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Separate audit trail PDF, or null when the account combines it into the signed PDF. */
export async function downloadAuditTrail(documentId: string): Promise<Uint8Array | null> {
  const res = await bs(`/v1/document/downloadAuditLog?documentId=${encodeURIComponent(documentId)}${behalf()}`);
  if (res.status === 412) return null;
  if (!res.ok) throw new Error(`BoldSign audit log download failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Split the combined signed PDF into one file per part (by page counts). Any pages after the
 * parts are the audit trail (when BoldSign combines it).
 */
export async function splitSigned(combined: Uint8Array, parts: { doc: DocKey; pages: number; certNo?: number }[]) {
  const src = await PDFDocument.load(combined);
  const total = src.getPageCount();
  const needed = parts.reduce((n, p) => n + p.pages, 0);
  if (total < needed) throw new Error(`Signed PDF has ${total} pages, expected at least ${needed}`);
  const out: { doc: DocKey; certNo?: number; bytes: Uint8Array; pages: number }[] = [];
  let start = 0;
  for (const part of parts) {
    const doc = await PDFDocument.create();
    const pages = await doc.copyPages(src, Array.from({ length: part.pages }, (_, i) => start + i));
    pages.forEach((p) => doc.addPage(p));
    out.push({ doc: part.doc, certNo: part.certNo, bytes: await doc.save(), pages: part.pages });
    start += part.pages;
  }
  let audit: Uint8Array | null = null;
  if (total > needed) {
    const doc = await PDFDocument.create();
    const pages = await doc.copyPages(src, Array.from({ length: total - needed }, (_, i) => needed + i));
    pages.forEach((p) => doc.addPage(p));
    audit = await doc.save();
  }
  return { parts: out, audit };
}

export async function revokeEnvelope(documentId: string, message: string) {
  await bsJson(`/v1/document/revoke?documentId=${encodeURIComponent(documentId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
}

export async function remind(documentId: string) {
  await bsJson(`/v1/document/remind?documentId=${encodeURIComponent(documentId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "A reminder to sign the corporate documents." }),
  });
}

/** Verify `X-BoldSign-Signature: t=<ts>,s0=<hex>[,s1=<hex>]` over "<ts>.<rawBody>". */
export function verifyWebhook(rawBody: string, header: string | null, secret: string, toleranceSec = 300) {
  if (!header || !secret) return false;
  const items = Object.fromEntries(
    header.split(",").map((p) => {
      const [k, ...v] = p.trim().split("=");
      return [k, v.join("=")];
    }),
  ) as Record<string, string>;
  const ts = Number(items.t);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${items.t}.${rawBody}`).digest("hex");
  return [items.s0, items.s1].some((s) => typeof s === "string" && s.length > 0 && safeEqual(expected, s));
}
