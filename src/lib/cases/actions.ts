// Admin POST actions for a case. Every guard is enforced here, not only in the UI.
import { addEvent, deleteCaseData, fileById, getCase, mutateCase, nowIso, randomId, setMilestone, storeFile } from "./cases";
import { config } from "./config";
import { type DocKey } from "./documents";
import { ASKABLE_FIELDS, trackingUrl, CARRIERS, type EmailKind } from "./emails";
import { attachEmailToCase, getInboxEmail, htmlToText, intakeEmail, listInbox, runExtraction, updateInboxItem } from "./inbound";
import { GuardError, requireActive, requireMilestones } from "./milestones";
import { FIELDS, isIsoDate, normaliseValue } from "./schema";
import { getFileBytes, readJson } from "./store";
import { remind } from "./boldsign";
import * as wf from "./workflow";
import type { Case, CaseFile } from "./types";

export type ActionResult = { ok: true; message: string; redirect?: string } | { ok: false; message: string };

const s = (form: FormData, k: string, max = 2000) => String(form.get(k) ?? "").trim().slice(0, max);

export const UPLOAD_TYPES: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };
export const MAX_UPLOAD = 25 * 1024 * 1024;

export function sniffType(bytes: Uint8Array) {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  return null;
}

type FileAs = "award_notarized" | "award_apostille" | "cert_notarized" | "cert_apostille" | "cert_proof" | "other";
const FILE_AS: Record<FileAs, { doc?: DocKey; kind: CaseFile["kind"]; label: string; cert?: boolean }> = {
  award_notarized: { doc: "award_letter", kind: "notarized", label: "Award Letter – notarized" },
  award_apostille: { doc: "award_letter", kind: "apostille", label: "Award Letter – apostille" },
  cert_notarized: { doc: "certificate", kind: "notarized", label: "notarized", cert: true },
  cert_apostille: { doc: "certificate", kind: "apostille", label: "apostille", cert: true },
  cert_proof: { kind: "proof", label: "payment evidence", cert: true },
  other: { kind: "upload", label: "Other" },
};

/** "File as…" choices for a case: certificate purposes once per issue ("cert_notarized:2"). */
export function fileAsOptions(c: Case) {
  const out: { value: string; label: string }[] = [
    { value: "award_notarized", label: FILE_AS.award_notarized.label },
    { value: "award_apostille", label: FILE_AS.award_apostille.label },
  ];
  for (const cert of c.certificates) {
    for (const k of ["cert_notarized", "cert_apostille", "cert_proof"] as const) out.push({ value: `${k}:${cert.no}`, label: `Certificate C${cert.no} – ${FILE_AS[k].label}` });
  }
  out.push({ value: "identity", label: "Identity document (passport / ID scan)" });
  out.push({ value: "not_identity", label: "Not an identity document" });
  out.push({ value: "other", label: "Other" });
  return out;
}

type Target = { as: FileAs; certNo?: number } | { as: "identity" | "not_identity" };

function parseAs(value: string): Target {
  const [as, no] = value.split(":");
  if (as === "identity" || as === "not_identity") return { as };
  if (!(as in FILE_AS)) throw new GuardError("Unknown file purpose.");
  const def = FILE_AS[as as FileAs];
  if (def.cert && !Number(no)) throw new GuardError("Choose a certificate.");
  return { as: as as FileAs, ...(def.cert ? { certNo: Number(no) } : {}) };
}

/** Record a stored file under a purpose: sets doc/certificate links and milestones. Runs inside mutateCase. */
function fileUnder(c: Case, file: CaseFile, target: Target, by: string) {
  if (target.as === "identity" || target.as === "not_identity") {
    if (file.deleted) throw new GuardError("This file was already deleted.");
    if (target.as === "identity") {
      file.identity = { by, at: nowIso() };
      addEvent(c, by, `Tagged "${file.name}" as an identity document (deleted 90 days after details are confirmed)`);
    } else {
      delete file.identity;
      addEvent(c, by, `Removed the identity-document tag from "${file.name}"`);
    }
    delete file.identitySuggested;
    return;
  }
  const def = FILE_AS[target.as];
  const certNo = "certNo" in target ? target.certNo : undefined;
  file.kind = def.kind;
  if (def.doc) file.doc = def.doc;
  if (def.cert) {
    const cert = wf.certByNo(c, certNo!);
    if (!cert) throw new GuardError(`Certificate C${certNo} not found.`);
    file.certNo = cert.no;
    if (def.kind === "proof") cert.files.proof = [...new Set([...cert.files.proof, file.id])];
    else cert.files.notarized = [...new Set([...cert.files.notarized, file.id])];
    addEvent(c, by, `Filed "${file.name}" as Certificate C${cert.no} – ${def.label}`);
    return;
  }
  if (def.doc && (def.kind === "notarized" || def.kind === "apostille")) {
    const rec = c.docs[def.doc];
    rec.notarized = [...new Set([...(rec.notarized ?? []), file.id])];
    setMilestone(c, "award_notarized", by);
  }
  addEvent(c, by, `Filed "${file.name}" as ${def.label}`);
}

function checkUpload(bytes: Uint8Array | null) {
  if (!bytes) throw new GuardError("The uploaded file was not found.");
  if (bytes.byteLength > MAX_UPLOAD) throw new GuardError("Files can be at most 25 MB.");
  const type = sniffType(bytes);
  if (!type) throw new GuardError("Only PDF, JPEG and PNG files are accepted.");
  return type;
}


export async function runCaseAction(caseId: string, form: FormData, user: { name: string }): Promise<ActionResult> {
  const by = user.name;
  const action = s(form, "_action", 50);
  try {
    switch (action) {
      case "save_fields":
      case "confirm": {
        const before = await wf.loadCase(caseId);
        requireActive(before);
        await mutateCase(caseId, by, (c) => {
          const changed: string[] = [];
          for (const def of FIELDS) {
            if (!form.has(`f_${def.key}`)) continue;
            const v = normaliseValue(def, form.get(`f_${def.key}`));
            const old = c.fields[def.key];
            if ((v ?? "") !== (old ?? "")) {
              changed.push(def.label);
              if (v === undefined) delete c.fields[def.key];
              else c.fields[def.key] = v;
            }
          }
          if (changed.length) addEvent(c, by, `Edited: ${changed.join(", ")}`);
        });
        if (action === "confirm") {
          await wf.confirmDetails(caseId, by);
          return { ok: true, message: "Details confirmed and documents generated." };
        }
        if (form.get("regenerate") === "1" && before.milestones.documents_generated) {
          await wf.regenerateInitial(caseId, by);
          return { ok: true, message: "Saved and documents regenerated." };
        }
        return { ok: true, message: "Details saved." };
      }
      case "generate": {
        await wf.regenerateInitial(caseId, by);
        return { ok: true, message: "Documents regenerated (and C1 while it is unsigned)." };
      }
      case "generate_award": {
        await wf.generateDocuments(caseId, by, { docs: ["award_letter"] });
        return { ok: true, message: "Award Letter regenerated." };
      }
      case "rerun_extraction": {
        const c = await wf.loadCase(caseId);
        const em = c.inbound[0];
        if (!em) throw new GuardError("This case has no intake email.");
        const raw = (await readJson<{ from: string; subject: string; text?: string; html?: string }>(`cases/${caseId}/inbound/${em.emailId}.json`))?.data;
        if (!raw) throw new GuardError("The stored intake email was not found.");
        const atts = [];
        for (const id of em.fileIds) {
          const f = fileById(c, id);
          const bytes = f && (await getFileBytes(f.path));
          if (f && bytes) atts.push({ filename: f.name, contentType: f.contentType, bytes });
        }
        const done = await runExtraction(caseId, { from: raw.from, subject: raw.subject, text: raw.text || htmlToText(raw.html ?? "") }, atts, by);
        return done.extraction?.error ? { ok: false, message: `Extraction failed: ${done.extraction.error}` } : { ok: true, message: "Extraction finished. Empty fields were filled; your edits were kept." };
      }
      case "send_signature": {
        await wf.sendForSignature(caseId, by);
        return { ok: true, message: config.live() ? "Sent for signature." : `Sent for signature (TEST: client signer is ${config.testRecipient()}).` };
      }
      case "refresh_signature": {
        const c = await wf.refreshSignature(caseId, by);
        return { ok: true, message: `BoldSign status: ${c.boldsign?.status ?? "–"}` };
      }
      case "remind_signature": {
        const c = await wf.loadCase(caseId);
        if (!c.boldsign) throw new GuardError("Nothing is out for signature.");
        await remind(c.boldsign.documentId);
        await mutateCase(caseId, by, (cc) => addEvent(cc, by, "BoldSign reminder sent"));
        return { ok: true, message: "Reminder sent." };
      }
      case "revoke_signature": {
        await wf.revokeSignature(caseId, by);
        return { ok: true, message: "Envelope revoked. You can now resend." };
      }
      case "reset_signature": {
        await wf.resetSignature(caseId, by);
        return { ok: true, message: "Ready to send a new envelope." };
      }
      case "send_email": {
        const kind = s(form, "kind", 10) as EmailKind;
        if (!["A", "B", "C", "tracking", "details"].includes(kind)) throw new GuardError("Unknown email.");
        const certNo = Number(s(form, "cert", 4)) || undefined;
        const items = form.getAll("items").map(String).filter((k) => ASKABLE_FIELDS.includes(k));
        await wf.sendClientEmail(caseId, kind, by, { certNo, items });
        const label = kind === "C" ? `Certificate C${certNo} email` : kind === "details" ? "Missing-details request" : `Email ${kind}`;
        return { ok: true, message: `${label} sent${config.live() ? "" : ` (TEST: to ${config.testRecipient()})`}.`, redirect: `/admin/cases/${caseId}#emails` };
      }
      case "notary_meeting": {
        const doc = s(form, "doc") as DocKey;
        if (doc !== "award_letter" && doc !== "certificate") throw new GuardError("Unknown document.");
        const certNo = Number(s(form, "cert", 4));
        const at = s(form, "at", 40);
        const day = at.slice(0, 10);
        if (!isIsoDate(day)) throw new GuardError("Enter the meeting date and time.");
        const notary = s(form, "notary", 200);
        const moveDate = form.get("move_date") === "1";
        const c0 = await wf.loadCase(caseId);
        if (c0.state === "on_hold" || c0.state === "cancelled") requireActive(c0);
        if (doc === "award_letter") {
          requireMilestones(c0, ["signatures_completed"], "The Award Letter notary meeting");
          await mutateCase(caseId, by, (c) => {
            c.milestones.award_notary_meeting = { at: nowIso(), by, data: { meeting: at, notary } };
            if (moveDate) c.fields.award_letter_date = day;
            addEvent(c, by, `Award Letter notary meeting set for ${at.replace("T", " ")}`);
          });
          if (moveDate && !(c0.docs.award_letter.notarized ?? []).length) await wf.generateDocuments(caseId, by, { docs: ["award_letter"] });
          return { ok: true, message: `Meeting saved${moveDate ? ` and Award Letter dated ${day}` : ""}.`, redirect: `/admin/cases/${caseId}#award` };
        }
        const cert = wf.certByNo(c0, certNo);
        if (!cert) throw new GuardError("Certificate not found.");
        // Re-dating is checked against the certificate's paragraph 5 before anything is saved.
        if (moveDate && !cert.files.notarized.length) await wf.regenerateCertificate(caseId, by, certNo, day);
        await mutateCase(caseId, by, (c) => {
          wf.certByNo(c, certNo)!.notary = { meeting: at, notary, at: nowIso(), by };
          addEvent(c, by, `Certificate C${certNo} notary meeting set for ${at.replace("T", " ")}`);
        });
        return { ok: true, message: `Meeting saved${moveDate ? ` and C${certNo} dated ${day}` : ""}.`, redirect: `/admin/cases/${caseId}#cert-${certNo}` };
      }
      case "register_upload": {
        const path = s(form, "path", 300);
        const target = parseAs(s(form, "as", 40));
        if (!path.startsWith(`cases/${caseId}/uploads/`) || path.includes("..")) throw new GuardError("Invalid upload.");
        const bytes = await getFileBytes(path);
        const type = checkUpload(bytes);
        const name = s(form, "name", 200) || path.split("/").pop()!;
        await mutateCase(caseId, by, (c) => {
          if (c.files.some((f) => f.path === path)) return;
          const file: CaseFile = { id: randomId(), path, name, kind: "upload", size: bytes!.byteLength, contentType: type, createdAt: nowIso(), by };
          c.files.push(file);
          fileUnder(c, file, target, by);
        });
        return { ok: true, message: `Uploaded ${name}.` };
      }
      case "file_as": {
        const fileId = s(form, "file", 40);
        const target = parseAs(s(form, "as", 40));
        const c0 = await wf.loadCase(caseId);
        const f0 = fileById(c0, fileId);
        if (!f0) throw new GuardError("File not found.");
        const bytes = await getFileBytes(f0.path);
        if (!["other", "identity", "not_identity"].includes(target.as)) checkUpload(bytes);
        await mutateCase(caseId, by, (c) => {
          fileUnder(c, fileById(c, fileId)!, target, by);
        });
        return { ok: true, message: "Filed." };
      }
      case "add_shipment": {
        const what = s(form, "what", 10); // "award" or a certificate number
        const certNo = what === "award" ? undefined : Number(what);
        const carrier = s(form, "carrier", 40);
        const tracking = s(form, "tracking", 80);
        const shippedAt = s(form, "shipped_at", 10);
        const setsRaw = s(form, "sets", 3);
        const sets = setsRaw ? Number(setsRaw) : undefined;
        if (sets !== undefined && !(Number.isInteger(sets) && sets >= 1 && sets <= 50)) throw new GuardError("Enter the number of sets (1 or more).");
        if (what !== "award" && !certNo) throw new GuardError("Choose what was shipped.");
        if (!CARRIERS.includes(carrier as (typeof CARRIERS)[number])) throw new GuardError("Choose a carrier.");
        if (!tracking) throw new GuardError("Enter the tracking number.");
        if (!isIsoDate(shippedAt)) throw new GuardError("Enter the shipped date.");
        await mutateCase(caseId, by, (c) => {
          if (certNo && !wf.certByNo(c, certNo)) throw new GuardError(`Certificate C${certNo} not found.`);
          const url = trackingUrl(carrier, tracking) ?? (s(form, "tracking_url", 300).startsWith("https://") ? s(form, "tracking_url", 300) : undefined);
          const id = randomId(4);
          const contents: DocKey[] = certNo ? ["certificate"] : ["award_letter"];
          c.shipments.push({ id, contents, ...(certNo ? { certNo } : {}), carrier, tracking, ...(url ? { trackingUrl: url } : {}), shippedAt, ...(sets ? { sets } : {}) });
          if (certNo) wf.certByNo(c, certNo)!.shipments.push(id);
          else setMilestone(c, "award_couriered", by);
          addEvent(c, by, `Shipment recorded: ${certNo ? `Certificate C${certNo}` : "Award Letter"}${sets ? `, ${sets} set(s)` : ""} via ${carrier}`);
        });
        return { ok: true, message: "Shipment recorded.", redirect: `/admin/cases/${caseId}${certNo ? `#cert-${certNo}` : "#shipments"}` };
      }
      case "shipment_delivered": {
        const sid = s(form, "shipment", 20);
        const day = s(form, "delivered_at", 10);
        if (!isIsoDate(day)) throw new GuardError("Enter the delivery date.");
        await mutateCase(caseId, by, (c) => {
          const sh = c.shipments.find((x) => x.id === sid);
          if (!sh) throw new GuardError("Shipment not found.");
          sh.deliveredAt = day;
          addEvent(c, by, `Shipment ${sh.tracking} delivered`);
        });
        return { ok: true, message: "Delivery recorded.", redirect: `/admin/cases/${caseId}#shipments` };
      }
      case "issue_certificate": {
        const payments = s(form, "payments_made", 6);
        const no = await wf.issuePaymentCertificate(caseId, by, {
          certificate_date: s(form, "certificate_date", 10),
          payments_made: /^\d+$/.test(payments) ? Number(payments) : NaN,
          last_payment_date: s(form, "last_payment_date", 10),
          attested: form.get("attest") === "1",
        });
        return { ok: true, message: `Certificate C${no} issued and generated.`, redirect: `/admin/cases/${caseId}#cert-${no}` };
      }
      case "regenerate_certificate": {
        const no = Number(s(form, "cert", 4));
        const day = s(form, "certificate_date", 10);
        await wf.regenerateCertificate(caseId, by, no, day || undefined);
        return { ok: true, message: `Certificate C${no} regenerated.`, redirect: `/admin/cases/${caseId}#cert-${no}` };
      }
      case "sign_certificate": {
        const no = Number(s(form, "cert", 4));
        await wf.sendCertificateForSignature(caseId, by, no);
        return { ok: true, message: `C${no} sent to ${config.spgSignerName()} for e-signature.`, redirect: `/admin/cases/${caseId}#cert-${no}` };
      }
      case "refresh_certificate": {
        const no = Number(s(form, "cert", 4));
        const c = await wf.refreshCertificateSignature(caseId, by, no);
        return { ok: true, message: `C${no} BoldSign status: ${wf.certByNo(c, no)?.boldsign?.status ?? "–"}`, redirect: `/admin/cases/${caseId}#cert-${no}` };
      }
      case "notes": {
        const notes = String(form.get("notes") ?? "").slice(0, 20000);
        await mutateCase(caseId, by, (c) => {
          c.notes = notes;
        });
        return { ok: true, message: "Notes saved.", redirect: `/admin/cases/${caseId}#notes` };
      }
      case "hold": {
        const reason = s(form, "reason", 500);
        if (!reason) throw new GuardError("Give a reason for the hold.");
        await mutateCase(caseId, by, (c) => {
          c.state = "on_hold";
          c.holdReason = reason;
          addEvent(c, by, `Put on hold: ${reason}`);
        });
        return { ok: true, message: "Case on hold." };
      }
      case "resume": {
        await mutateCase(caseId, by, (c) => {
          c.state = "active";
          delete c.holdReason;
          addEvent(c, by, "Resumed");
        });
        return { ok: true, message: "Case resumed." };
      }
      case "cancel": {
        await mutateCase(caseId, by, (c) => {
          c.state = "cancelled";
          addEvent(c, by, `Cancelled${s(form, "reason", 500) ? `: ${s(form, "reason", 500)}` : ""}`);
        });
        return { ok: true, message: "Case cancelled. No data was deleted." };
      }
      case "close": {
        await mutateCase(caseId, by, (c) => {
          c.state = "closed";
          setMilestone(c, "closed", by);
          addEvent(c, by, "Case closed");
        });
        return { ok: true, message: "Case closed." };
      }
      case "reopen": {
        await mutateCase(caseId, by, (c) => {
          c.state = "active";
          delete c.milestones.closed;
          addEvent(c, by, "Reopened");
        });
        return { ok: true, message: "Case reopened." };
      }
      case "delete_case": {
        if (s(form, "confirm", 40) !== caseId) throw new GuardError(`Type ${caseId} to confirm deletion.`);
        const n = await deleteCaseData(caseId);
        console.log(`[cases] case data deleted ${caseId} (${n} blobs) by ${by}`);
        return { ok: true, message: `Deleted all data for ${caseId}.`, redirect: "/admin" };
      }
      default:
        return { ok: false, message: "Unknown action." };
    }
  } catch (err) {
    if (err instanceof GuardError) return { ok: false, message: err.message };
    if ((err as Error).name === "DocumentFieldsError") return { ok: false, message: (err as Error).message };
    console.error(`[cases] action ${action} failed on ${caseId}:`, (err as Error).message);
    return { ok: false, message: `Something went wrong: ${(err as Error).message.slice(0, 200)}` };
  }
}

/** Unassigned inbox actions. */
export async function runInboxAction(form: FormData, user: { name: string }): Promise<ActionResult> {
  const by = user.name;
  const action = s(form, "_action", 40);
  const emailId = s(form, "email", 80);
  try {
    const item = (await listInbox()).find((i) => i.emailId === emailId);
    if (!item) throw new GuardError("Email not found.");
    if (item.status !== "open" && action !== "reopen") throw new GuardError("This email was already handled.");
    const email = await getInboxEmail(emailId);
    if (!email) throw new GuardError("Stored email not found.");
    const atts = [];
    if (action === "create_case" || action === "attach") {
      for (const f of item.files) {
        const bytes = await getFileBytes(f.path);
        if (bytes) atts.push({ filename: f.name, contentType: f.contentType, bytes });
      }
    }
    if (action === "create_case") {
      const c = await intakeEmail(email, atts, by);
      await updateInboxItem(emailId, { status: "converted", caseId: c.id, handledBy: by });
      return { ok: true, message: `Created ${c.id}.`, redirect: `/admin/cases/${c.id}` };
    }
    if (action === "attach") {
      const target = s(form, "case", 20).toUpperCase();
      const c = await getCase(target);
      if (!c) throw new GuardError(`Case ${target} not found.`);
      await attachEmailToCase(c, email, atts, by);
      await updateInboxItem(emailId, { status: "attached", caseId: c.id, handledBy: by });
      return { ok: true, message: `Attached to ${c.id}.`, redirect: `/admin/cases/${c.id}#inbox` };
    }
    if (action === "dismiss") {
      await updateInboxItem(emailId, { status: "dismissed", handledBy: by });
      return { ok: true, message: "Dismissed." };
    }
    if (action === "reopen") {
      await updateInboxItem(emailId, { status: "open", handledBy: by });
      return { ok: true, message: "Reopened." };
    }
    return { ok: false, message: "Unknown action." };
  } catch (err) {
    if (err instanceof GuardError) return { ok: false, message: err.message };
    console.error(`[cases] inbox action ${action} failed:`, (err as Error).message);
    return { ok: false, message: `Something went wrong: ${(err as Error).message.slice(0, 200)}` };
  }
}

export { storeFile };
