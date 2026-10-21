// Case archive: every stored file (current and earlier versions) plus case-summary.pdf.
import { DOCS } from "./documents";
import { fontFaceCss } from "./fonts";
import { caseStatus, MILESTONES } from "./milestones";
import { FIELDS, formatDate } from "./schema";
import { getFileBytes, readJson } from "./store";
import { escapeHtml } from "./templates/render";
import type { Case, CaseFile } from "./types";
import type { ZipEntry } from "./zip";

const e = (v: unknown) => escapeHtml(String(v ?? ""));
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }) + " ET" : "");
const day = (iso?: string) => {
  try {
    return iso ? formatDate(iso.slice(0, 10)) : "";
  } catch {
    return iso ?? "";
  }
};

/** Which documents a file is the current/signed/notarized version of, for the summary. */
function fileRole(c: Case, f: CaseFile) {
  const roles: string[] = [];
  for (const [k, rec] of Object.entries(c.docs)) {
    if (k === "certificate") continue;
    if (rec.current === f.id) roles.push("current");
    if (rec.signed === f.id) roles.push("signed");
    if (rec.notarized?.includes(f.id)) roles.push("notarized/apostille");
  }
  for (const cert of c.certificates) {
    if (cert.files.current === f.id) roles.push(`C${cert.no} current`);
    if (cert.files.signed === f.id) roles.push(`C${cert.no} signed`);
    if (cert.files.notarized.includes(f.id)) roles.push(`C${cert.no} notarized/apostille`);
    if (cert.files.proof.includes(f.id)) roles.push(`C${cert.no} payment evidence`);
  }
  if (f.identity) roles.push("identity document");
  return roles.join(", ") || (f.kind === "draft" ? "earlier version" : "");
}

/** Folder for a file inside the archive. */
function folder(f: CaseFile) {
  if (f.certNo) return `certificates/C${f.certNo}`;
  switch (f.kind) {
    case "draft": return "documents/generated";
    case "signed": return "documents/signed";
    case "notarized":
    case "apostille": return "documents/notarized";
    case "audit_trail": return "documents/signed";
    case "inbound": return "inbound/attachments";
    case "proof": return "payments";
    default: return "uploads";
  }
}

const stamp = (iso: string) => iso.slice(0, 16).replace("T", " ").replace(":", "");

export function summaryHtml(c: Case, generatedBy: string) {
  const status = caseStatus(c);
  const rows = (pairs: [string, unknown][]) => pairs.map(([k, v]) => `<tr><th>${e(k)}</th><td>${e(v)}</td></tr>`).join("");
  const fieldRows = FIELDS.map((f) => {
    const v = c.fields[f.key];
    const shown = v === undefined || v === "" ? "–" : typeof v === "boolean" ? (v ? "Yes" : "No") : f.type === "date" ? day(String(v)) : String(v);
    return [f.label, shown] as [string, unknown];
  });
  const table = (head: string[], body: string[][]) =>
    `<table class="grid"><thead><tr>${head.map((h) => `<th>${e(h)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((x) => `<td>${e(x)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${head.length}">None</td></tr>`}</tbody></table>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${e(c.id)} case summary</title><style>${fontFaceCss()}
@page { size: 8.5in 11in; margin: 0.7in 0.7in 0.9in; }
body { font-family: Inter, sans-serif; font-size: 8.5pt; color: #1F2D3D; line-height: 1.4; }
h1 { font-size: 16pt; margin: 0 0 2pt; } h2 { font-size: 10.5pt; margin: 16pt 0 5pt; border-bottom: 0.75pt solid #CCC; padding-bottom: 2pt; }
p.meta { color: #555; margin: 0 0 6pt; }
table { width: 100%; border-collapse: collapse; } th, td { text-align: left; vertical-align: top; padding: 2.5pt 5pt; border-bottom: 0.5pt solid #E2E2E2; }
table.kv th { width: 34%; color: #555; font-weight: 600; } table.grid thead th { background: #F2F2F2; font-weight: 700; }
tr { break-inside: avoid; }
</style></head><body>
<h1>${e(c.id)} · ${e(c.fields.company_name || "(no company)")}</h1>
<p class="meta">Case summary generated ${e(when(new Date().toISOString()))} by ${e(generatedBy)}. State: ${e(c.state)}${c.holdReason ? ` (${e(c.holdReason)})` : ""} · Status: ${e(status.label)} · Created ${e(when(c.createdAt))} from ${e(c.source.type)}${c.source.from ? ` (${e(c.source.from)})` : ""}</p>
<h2>Details</h2><table class="kv">${rows(fieldRows)}</table>
<h2>Milestones</h2>${table(["Milestone", "Done", "By"], MILESTONES.map((m) => [m.label, when(c.milestones[m.key]?.at) || "–", c.milestones[m.key]?.by ?? ""]))}
<h2>Certificates</h2>${table(["Issue", "Variant", "Date", "Payments", "Attested", "Signed", "Notarized", "Emailed"], c.certificates.map((x) => [x.ref, x.variant, day(x.certificate_date), x.variant === "payment_history" ? `${x.payments_made}, last ${day(x.last_payment_date)}` : "–", x.attestedBy ? `${x.attestedBy.name}, ${when(x.attestedBy.at)}` : "–", x.files.signed ? "yes" : "no", x.files.notarized.length ? "yes" : "no", when(x.emailedAt) || "no"]))}
<h2>Signing (BoldSign)</h2>${c.boldsign ? `<table class="kv">${rows([["Document id", c.boldsign.documentId], ["Status", c.boldsign.status], ["Sent", when(c.boldsign.sentAt)], ["Completed", when(c.boldsign.completedAt) || "–"], ["Documents", c.boldsign.parts.map((p) => (p.certNo ? `Certificate C${p.certNo}` : DOCS[p.doc].title)).join(", ")]])}</table>` : "<p>Not sent.</p>"}
<h2>Shipments</h2>${table(["Contents", "Sets", "Carrier", "Tracking", "Shipped", "Delivered"], c.shipments.map((s) => [s.certNo ? `Certificate C${s.certNo}` : "Award Letter", String(s.sets ?? "–"), s.carrier, s.tracking, day(s.shippedAt), day(s.deliveredAt) || "–"]))}
<h2>Emails sent to the client</h2>${table(["Sent", "Email", "Language", "To", "Subject", "Attachments"], c.emails.map((m) => [when(m.sentAt), m.kind === "C" ? `C${m.certNo}` : m.kind, m.lang ?? "en", `${m.to.join(", ")}${m.redirectedFrom ? ` (TEST, for ${m.redirectedFrom.join(", ")})` : ""}`, m.subject, String(m.attachments?.length ?? 0)]))}
<h2>Files</h2>${table(["File", "Kind", "Role", "Stored"], c.files.map((f) => [f.name, f.kind, f.deleted ? `deleted ${day(f.deleted.at)} (${f.deleted.reason})` : fileRole(c, f), when(f.createdAt)]))}
<h2>Notes</h2><p>${e(c.notes || "–").replace(/\n/g, "<br>")}</p>
<h2>Event log</h2>${table(["When", "By", "Event"], c.events.map((x) => [when(x.at), x.by, x.text]))}
</body></html>`;
}

/** Archive entries, produced one at a time. */
export async function* archiveEntries(c: Case, summaryPdf: Uint8Array): AsyncGenerator<ZipEntry> {
  yield { name: "case-summary.pdf", bytes: summaryPdf };
  for (const f of c.files) {
    if (f.deleted) continue;
    const bytes = await getFileBytes(f.path);
    if (!bytes) continue;
    yield { name: `${folder(f)}/${f.kind === "draft" ? `${stamp(f.createdAt)} ` : ""}${f.name}`, bytes, date: new Date(f.createdAt) };
  }
  for (const i of c.inbound) {
    const raw = await readJson<{ from?: string; to?: string[]; subject?: string; created_at?: string; text?: string }>(`cases/${c.id}/inbound/${i.emailId}.json`).catch(() => null);
    if (!raw) continue;
    const m = raw.data;
    const text = `From: ${m.from ?? ""}\nTo: ${(m.to ?? []).join(", ")}\nDate: ${m.created_at ?? ""}\nSubject: ${m.subject ?? ""}\n\n${m.text ?? ""}`;
    const safe = (i.subject || "email").replace(/[\\/:*?"<>|]+/g, " ").slice(0, 80).trim();
    yield { name: `inbound/emails/${stamp(i.receivedAt)} ${safe}.txt`, bytes: new TextEncoder().encode(text), date: new Date(i.receivedAt) };
  }
}
