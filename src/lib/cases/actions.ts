// Admin POST actions for a case. Every guard is enforced here, not only in the UI.
import { addEvent, deleteCaseData, fileById, getCase, mutateCase, nowIso, randomId, setMilestone, storeFile } from "./cases";
import { config } from "./config";
import { DOCS, INITIAL_DOCS, type DocKey } from "./documents";
import { trackingUrl, CARRIERS, type EmailKind } from "./emails";
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

type FileAs = "award_notarized" | "award_apostille" | "cert_notarized" | "cert_apostille" | "payment_proof" | "other";
const FILE_AS: Record<FileAs, { doc?: DocKey; kind: CaseFile["kind"]; label: string }> = {
  award_notarized: { doc: "award_letter", kind: "notarized", label: "Award Letter – notarized" },
  award_apostille: { doc: "award_letter", kind: "apostille", label: "Award Letter – apostille" },
  cert_notarized: { doc: "certificate", kind: "notarized", label: "Certificate – notarized" },
  cert_apostille: { doc: "certificate", kind: "apostille", label: "Certificate – apostille" },
  payment_proof: { kind: "proof", label: "Payment proof" },
  other: { kind: "upload", label: "Other" },
};
export const FILE_AS_OPTIONS = Object.entries(FILE_AS).map(([k, v]) => ({ value: k, label: v.label }));

/** Record a stored file under a purpose: sets doc links and milestones. Runs inside mutateCase. */
function fileUnder(c: Case, file: CaseFile, as: FileAs, by: string) {
  const def = FILE_AS[as];
  if (!def) throw new GuardError("Unknown file purpose.");
  if (def.doc === "certificate") requireMilestones(c, ["first_payment_confirmed"], "Filing certificate documents");
  file.kind = def.kind;
  if (def.doc) file.doc = def.doc;
  if (def.doc && (def.kind === "notarized" || def.kind === "apostille")) {
    const rec = c.docs[def.doc];
    rec.notarized = [...new Set([...(rec.notarized ?? []), file.id])];
    setMilestone(c, def.doc === "award_letter" ? "award_notarized" : "certificate_notarized", by);
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

function selectedDocs(form: FormData) {
  return form.getAll("contents").map(String).filter((d): d is DocKey => d in DOCS);
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
          await wf.generateDocuments(caseId, by);
          return { ok: true, message: "Saved and documents regenerated." };
        }
        return { ok: true, message: "Details saved." };
      }
      case "generate": {
        await wf.generateDocuments(caseId, by, INITIAL_DOCS);
        return { ok: true, message: "Documents regenerated." };
      }
      case "generate_award": {
        await wf.generateDocuments(caseId, by, ["award_letter"]);
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
        if (!["A", "B", "C", "tracking"].includes(kind)) throw new GuardError("Unknown email.");
        await wf.sendClientEmail(caseId, kind, by);
        return { ok: true, message: `Email ${kind} sent${config.live() ? "" : ` (TEST: to ${config.testRecipient()})`}.`, redirect: `/admin/cases/${caseId}#emails` };
      }
      case "notary_meeting": {
        const doc = s(form, "doc") as DocKey;
        if (doc !== "award_letter" && doc !== "certificate") throw new GuardError("Unknown document.");
        const at = s(form, "at", 40);
        const day = at.slice(0, 10);
        if (!isIsoDate(day)) throw new GuardError("Enter the meeting date and time.");
        const c0 = await wf.loadCase(caseId);
        requireActive(c0);
        if (doc === "award_letter") requireMilestones(c0, ["signatures_completed"], "The Award Letter notary meeting");
        else requireMilestones(c0, ["certificate_generated"], "The certificate notary meeting");
        const moveDate = form.get("move_date") === "1";
        await mutateCase(caseId, by, (c) => {
          const key = doc === "award_letter" ? "award_notary_meeting" : "certificate_notary_meeting";
          c.milestones[key] = { at: nowIso(), by, data: { meeting: at, notary: s(form, "notary", 200) } };
          if (moveDate) c.fields[doc === "award_letter" ? "award_letter_date" : "certificate_date"] = day;
          addEvent(c, by, `${DOCS[doc].short} notary meeting set for ${at.replace("T", " ")}`);
        });
        if (moveDate) {
          const notarized = (c0.docs[doc].notarized ?? []).length > 0;
          if (!notarized) await wf.generateDocuments(caseId, by, [doc]);
        }
        return { ok: true, message: `Meeting saved${moveDate ? ` and ${DOCS[doc].short} dated ${day}` : ""}.` };
      }
      case "register_upload": {
        const path = s(form, "path", 300);
        const as = s(form, "as", 40) as FileAs;
        if (!path.startsWith(`cases/${caseId}/uploads/`) || path.includes("..")) throw new GuardError("Invalid upload.");
        const bytes = await getFileBytes(path);
        const type = checkUpload(bytes);
        const name = s(form, "name", 200) || path.split("/").pop()!;
        await mutateCase(caseId, by, (c) => {
          if (c.files.some((f) => f.path === path)) return;
          const file: CaseFile = { id: randomId(), path, name, kind: "upload", size: bytes!.byteLength, contentType: type, createdAt: nowIso(), by };
          c.files.push(file);
          fileUnder(c, file, as, by);
        });
        return { ok: true, message: `Uploaded ${name}.` };
      }
      case "file_as": {
        const fileId = s(form, "file", 40);
        const as = s(form, "as", 40) as FileAs;
        const c0 = await wf.loadCase(caseId);
        const f0 = fileById(c0, fileId);
        if (!f0) throw new GuardError("File not found.");
        const bytes = await getFileBytes(f0.path);
        if (as !== "other") checkUpload(bytes);
        await mutateCase(caseId, by, (c) => {
          const f = fileById(c, fileId)!;
          fileUnder(c, f, as, by);
        });
        return { ok: true, message: `Filed as ${FILE_AS[as].label}.` };
      }
      case "add_shipment": {
        const contents = selectedDocs(form);
        const carrier = s(form, "carrier", 40);
        const tracking = s(form, "tracking", 80);
        const shippedAt = s(form, "shipped_at", 10);
        if (!contents.length) throw new GuardError("Choose what was shipped.");
        if (!CARRIERS.includes(carrier as (typeof CARRIERS)[number])) throw new GuardError("Choose a carrier.");
        if (!tracking) throw new GuardError("Enter the tracking number.");
        if (!isIsoDate(shippedAt)) throw new GuardError("Enter the shipped date.");
        await mutateCase(caseId, by, (c) => {
          const url = trackingUrl(carrier, tracking) ?? (s(form, "tracking_url", 300).startsWith("https://") ? s(form, "tracking_url", 300) : undefined);
          c.shipments.push({ id: randomId(4), contents, carrier, tracking, ...(url ? { trackingUrl: url } : {}), shippedAt });
          if (contents.includes("award_letter")) setMilestone(c, "award_couriered", by);
          if (contents.includes("certificate")) setMilestone(c, "certificate_couriered", by);
          addEvent(c, by, `Shipment recorded: ${contents.map((d) => DOCS[d].short).join(", ")} via ${carrier}`);
        });
        return { ok: true, message: "Shipment recorded.", redirect: `/admin/cases/${caseId}#shipments` };
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
      case "confirm_payment": {
        const day = s(form, "first_payment_date", 10);
        if (!isIsoDate(day)) throw new GuardError("Enter the date of the first payment.");
        if (form.get("confirm") !== "1") throw new GuardError("Tick the confirmation that the payment was made from the Designated Fund.");
        const c0 = await wf.loadCase(caseId);
        requireActive(c0);
        requireMilestones(c0, ["signatures_completed"], "Confirming the first payment");
        await mutateCase(caseId, by, (c) => {
          c.fields.first_payment_date = day;
          if (!c.fields.certificate_date) c.fields.certificate_date = new Date().toISOString().slice(0, 10);
          setMilestone(c, "first_payment_confirmed", by, { first_payment_date: day });
          addEvent(c, by, `First pension payment confirmed (${day})`);
        });
        await wf.generateDocuments(caseId, by, ["certificate"]);
        return { ok: true, message: "Payment confirmed and certificate generated." };
      }
      case "generate_certificate": {
        const day = s(form, "certificate_date", 10);
        if (day && !isIsoDate(day)) throw new GuardError("Enter a valid certificate date.");
        const c0 = await wf.loadCase(caseId);
        requireMilestones(c0, ["first_payment_confirmed"], "The certificate");
        if (day) await mutateCase(caseId, by, (c) => void (c.fields.certificate_date = day));
        await wf.generateDocuments(caseId, by, ["certificate"]);
        return { ok: true, message: "Certificate generated." };
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
