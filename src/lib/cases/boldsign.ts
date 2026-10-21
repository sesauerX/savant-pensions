// BoldSign: send the 3 corporate documents in one envelope, poll status, download and
// split the signed result, and verify webhooks.
import { createHmac } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { config } from "./config";
import { safeEqual } from "./http";
import type { DocKey } from "./types";

const API = "https://api.boldsign.com";

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

/** Text tag definitions (spec §6.6). SignerIndex is 1-based: 1 = client, 2 = Sterling. */
const TAGS: { id: string; type: "Signature" | "DateSigned"; signer: 1 | 2 }[] = [
  { id: "client_sig_oa", type: "Signature", signer: 1 },
  { id: "client_date_oa", type: "DateSigned", signer: 1 },
  { id: "spg_sig_oa", type: "Signature", signer: 2 },
  { id: "spg_sig_policy", type: "Signature", signer: 2 },
  { id: "client_sig_consent", type: "Signature", signer: 1 },
  { id: "spg_sig_consent", type: "Signature", signer: 2 },
];

export type SendInput = {
  title: string;
  message: string;
  files: { name: string; bytes: Uint8Array }[];
  client: { name: string; email: string };
  spg: { name: string; email: string };
};

export async function sendEnvelope(input: SendInput): Promise<string> {
  const form = new FormData();
  form.set("Title", input.title);
  form.set("Message", input.message);
  form.set("EnableSigningOrder", "true");
  form.set("UseTextTags", "true");
  form.set("ExpiryDays", "30");
  form.set("ReminderSettings.EnableAutoReminder", "true");
  form.set("ReminderSettings.ReminderDays", "3");
  form.set("ReminderSettings.ReminderCount", "5");
  form.set("HideDocumentId", "false");
  // Local smoke tests only: create the envelope without emailing anyone.
  if (process.env.BOLDSIGN_DISABLE_EMAILS === "true") form.set("DisableEmails", "true");
  const signers = [
    { ...input.client, order: 1 },
    { ...input.spg, order: 2 },
  ];
  signers.forEach((s, i) => {
    form.set(`Signers[${i}][Name]`, s.name);
    form.set(`Signers[${i}][EmailAddress]`, s.email);
    form.set(`Signers[${i}][SignerOrder]`, String(s.order));
    form.set(`Signers[${i}][SignerType]`, "Signer");
  });
  TAGS.forEach((t, i) => {
    form.set(`TextTagDefinitions[${i}][DefinitionId]`, t.id);
    form.set(`TextTagDefinitions[${i}][Type]`, t.type);
    form.set(`TextTagDefinitions[${i}][SignerIndex]`, String(t.signer));
    form.set(`TextTagDefinitions[${i}][IsRequired]`, "true");
    form.set(`TextTagDefinitions[${i}][Size][Width]`, t.type === "Signature" ? "200" : "110");
    form.set(`TextTagDefinitions[${i}][Size][Height]`, t.type === "Signature" ? "40" : "18");
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
  const d = await bsJson(`/v1/document/properties?documentId=${encodeURIComponent(documentId)}`);
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
  const res = await bs(`/v1/document/download?documentId=${encodeURIComponent(documentId)}`);
  if (!res.ok) throw new Error(`BoldSign download failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Separate audit trail PDF, or null when the account combines it into the signed PDF. */
export async function downloadAuditTrail(documentId: string): Promise<Uint8Array | null> {
  const res = await bs(`/v1/document/downloadAuditLog?documentId=${encodeURIComponent(documentId)}`);
  if (res.status === 412) return null;
  if (!res.ok) throw new Error(`BoldSign audit log download failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Split the combined signed PDF into one file per part (by page counts). Any pages after the
 * parts are the audit trail (when BoldSign combines it).
 */
export async function splitSigned(combined: Uint8Array, parts: { doc: DocKey; pages: number }[]) {
  const src = await PDFDocument.load(combined);
  const total = src.getPageCount();
  const needed = parts.reduce((n, p) => n + p.pages, 0);
  if (total < needed) throw new Error(`Signed PDF has ${total} pages, expected at least ${needed}`);
  const out: { doc: DocKey; bytes: Uint8Array; pages: number }[] = [];
  let start = 0;
  for (const part of parts) {
    const doc = await PDFDocument.create();
    const pages = await doc.copyPages(src, Array.from({ length: part.pages }, (_, i) => start + i));
    pages.forEach((p) => doc.addPage(p));
    out.push({ doc: part.doc, bytes: await doc.save(), pages: part.pages });
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
