// Case workflow steps shared by admin actions, webhooks and cron.
import * as boldsign from "./boldsign";
import { addEvent, fileById, getCase, mutateCase, nowIso, setMilestone, storeFile } from "./cases";
import { config } from "./config";
import { BOLDSIGN_DOCS, DOCS, INITIAL_DOCS, docFileName, renderDocuments, type DocKey } from "./documents";
import { buildEmail, type EmailKind } from "./emails";
import { sendEmail, notifyAdmins } from "./mail";
import { GuardError, requireActive, requireMilestones } from "./milestones";
import { fieldError, FIELD_BY_KEY, formatDate, missingFields, todayIso } from "./schema";
import { getFileBytes, writeJson, deleteFile } from "./store";
import type { Case, CaseFile } from "./types";

const caseLink = (id: string) => `${config.siteUrl()}/admin/cases/${id}`;

export async function loadCase(id: string) {
  const c = await getCase(id);
  if (!c) throw new GuardError("Case not found.");
  return c;
}

/** Refuse anything client-facing when live but templates are not approved (spec §12). */
export function requireSendAllowed() {
  if (config.live() && !config.templatesApproved()) {
    throw new GuardError("LIVE_MODE is on but TEMPLATES_APPROVED is not: nothing can be sent to a real client until counsel has approved the templates.");
  }
}

export function fieldProblems(c: Case) {
  const problems: string[] = [];
  const missing = missingFields(c.fields);
  if (missing.length) problems.push(`Missing: ${missing.map((k) => FIELD_BY_KEY[k].label).join(", ")}`);
  for (const [k, v] of Object.entries(c.fields)) {
    const def = FIELD_BY_KEY[k];
    const err = def && fieldError(def, v);
    if (err) problems.push(`${def.label}: ${err}`);
  }
  return problems;
}

// ---- Documents

export async function generateDocuments(id: string, by: string, docs: DocKey[] = INITIAL_DOCS) {
  const c = await loadCase(id);
  requireActive(c);
  requireMilestones(c, ["details_confirmed"], "Generating documents");
  if (docs.includes("certificate")) requireMilestones(c, ["first_payment_confirmed"], "The certificate");
  const problems = fieldProblems(c);
  if (problems.length) throw new GuardError(problems.join(" · "));
  const rendered = await renderDocuments(docs, c.fields, c.id);
  const stored: CaseFile[] = [];
  for (const r of rendered) {
    stored.push(await storeFile(c.id, { bytes: r.pdf, name: r.name, kind: "draft", contentType: "application/pdf", by, doc: r.doc, templateVersion: r.version, pages: r.pages }));
  }
  return mutateCase(c.id, by, (cc) => {
    for (const f of stored) {
      const rec = cc.docs[f.doc!];
      if (rec.current) rec.history.push(rec.current);
      rec.current = f.id;
      cc.files.push(f);
    }
    const names = stored.map((f) => `${DOCS[f.doc!].short} (${f.templateVersion})`).join(", ");
    if (docs.includes("certificate")) setMilestone(cc, "certificate_generated", by);
    if (docs.some((d) => d !== "certificate")) setMilestone(cc, "documents_generated", by);
    addEvent(cc, by, `Generated ${names}${config.templatesApproved() ? "" : " with DRAFT watermark"}`);
  });
}

export async function confirmDetails(id: string, by: string) {
  const c = await loadCase(id);
  requireActive(c);
  const problems = fieldProblems(c);
  if (problems.length) throw new GuardError(problems.join(" · "));
  await mutateCase(id, by, (cc) => {
    setMilestone(cc, "received", by);
    setMilestone(cc, "details_confirmed", by);
    addEvent(cc, by, "Details confirmed");
  });
  return generateDocuments(id, by);
}

// ---- Signing

export async function sendForSignature(id: string, by: string) {
  requireSendAllowed();
  const c = await loadCase(id);
  requireActive(c);
  requireMilestones(c, ["details_confirmed", "documents_generated"], "Sending for signature");
  const pending = c.boldsign && !["Declined", "Expired", "Revoked", "Failed"].includes(c.boldsign.status);
  if (pending && !c.milestones.signatures_completed) throw new GuardError("An envelope is already out for signature. Revoke it or wait for it to finish.");
  if (c.milestones.signatures_completed) throw new GuardError("Signatures are already complete.");
  if (!config.boldsignKey()) throw new GuardError("BOLDSIGN_API_KEY is not configured.");
  if (!config.spgSignerEmail()) throw new GuardError("SPG_SIGNER_EMAIL is not configured.");

  const files = [];
  const parts: { doc: DocKey; pages: number }[] = [];
  for (const doc of BOLDSIGN_DOCS) {
    const f = fileById(c, c.docs[doc].current);
    if (!f) throw new GuardError(`No current ${DOCS[doc].title} to send. Generate documents first.`);
    const bytes = await getFileBytes(f.path);
    if (!bytes) throw new GuardError(`Stored ${DOCS[doc].title} could not be read.`);
    const { PDFDocument } = await import("pdf-lib");
    const pages = f.pages ?? (await PDFDocument.load(bytes)).getPageCount();
    files.push({ name: docFileName(c.id, doc), bytes });
    parts.push({ doc, pages });
  }
  const realEmail = String(c.fields.member_email);
  const clientEmail = config.live() ? realEmail : config.testRecipient();
  if (!clientEmail) throw new GuardError("TEST_RECIPIENT is not set (test mode).");
  const company = String(c.fields.company_name);
  const documentId = await boldsign.sendEnvelope({
    title: `${c.id} – ${company} – Corporate documents`,
    message: `Please review and sign the corporate documents of ${company}. Sterling Pension Group LLC countersigns as Plan Administrator after you.`,
    files,
    client: { name: String(c.fields.member_name), email: clientEmail },
    spg: { name: config.spgSignerName(), email: config.spgSignerEmail() },
  });
  await writeJson(`boldsign/doc-${documentId.replace(/[^\w-]/g, "")}.json`, { caseId: id });
  return mutateCase(id, by, (cc) => {
    const history = [...(cc.boldsign?.history ?? []), ...(cc.boldsign ? [{ documentId: cc.boldsign.documentId, status: cc.boldsign.status, at: nowIso() }] : [])];
    cc.boldsign = {
      documentId,
      status: "Sent",
      sentAt: nowIso(),
      parts,
      signingDatePrinted: String(cc.fields.signing_date ?? ""),
      ...(config.live() ? {} : { redirectedFrom: realEmail }),
      history,
    };
    cc.milestones.sent_for_signature = { at: nowIso(), by };
    addEvent(cc, by, `Sent for signature via BoldSign${config.live() ? "" : ` (TEST: client signer redirected to ${clientEmail})`}`);
  });
}

const FINAL_BAD = ["Declined", "Expired", "Revoked"];

/** Poll BoldSign and act on the status. Safe to call from the page, cron and webhook. */
export async function refreshSignature(id: string, by: string) {
  const c = await loadCase(id);
  if (!c.boldsign || c.milestones.signatures_completed) return c;
  const s = await boldsign.getStatus(c.boldsign.documentId);
  const before = c.boldsign.status;
  const updated = await mutateCase(id, by, (cc) => {
    if (!cc.boldsign) return;
    cc.boldsign.status = s.status;
    cc.boldsign.signers = s.signers;
    cc.boldsign.lastPolledAt = nowIso();
    if (s.status !== before) addEvent(cc, by, `BoldSign status: ${s.status}`);
  });
  if (s.status === "Completed") return completeSigning(id, by);
  if (FINAL_BAD.includes(s.status) && s.status !== before) {
    await notifyAdmins(`${id}: signature ${s.status.toLowerCase()}`, [`The BoldSign envelope for case ${id} was ${s.status.toLowerCase()}.`, "Open the case to resend for signature."], caseLink(id));
  }
  return updated;
}

/** Download, split and store the signed result, then send email A. Idempotent. */
export async function completeSigning(id: string, by: string) {
  const c = await loadCase(id);
  if (!c.boldsign || c.milestones.signatures_completed) return c;
  const lock = `cases/${id}/locks/signing-${c.boldsign.documentId}.json`;
  try {
    await writeJson(lock, { at: nowIso() }, { create: true });
  } catch {
    return c; // another invocation is processing it
  }
  try {
    const combined = await boldsign.downloadSigned(c.boldsign.documentId);
    const split = await boldsign.splitSigned(combined, c.boldsign.parts);
    const audit = (await boldsign.downloadAuditTrail(c.boldsign.documentId)) ?? split.audit;
    const stored: CaseFile[] = [];
    for (const p of split.parts) {
      stored.push(await storeFile(id, { bytes: p.bytes, name: docFileName(id, p.doc).replace(".pdf", " (signed).pdf"), kind: "signed", contentType: "application/pdf", by, doc: p.doc, pages: p.pages }));
    }
    const auditFile = audit ? await storeFile(id, { bytes: audit, name: `${id} - Signing certificate (audit trail).pdf`, kind: "audit_trail", contentType: "application/pdf", by }) : null;
    const today = todayIso();
    await mutateCase(id, by, (cc) => {
      if (cc.milestones.signatures_completed) return;
      for (const f of stored) {
        cc.docs[f.doc!].signed = f.id;
        cc.files.push(f);
      }
      if (auditFile) cc.files.push(auditFile);
      if (cc.boldsign) {
        cc.boldsign.status = "Completed";
        cc.boldsign.completedAt = nowIso();
      }
      setMilestone(cc, "signatures_completed", by);
      addEvent(cc, by, `Signatures completed; ${stored.length} signed documents${auditFile ? " and audit trail" : ""} stored`);
      const printed = cc.boldsign?.signingDatePrinted;
      if (printed && printed !== today) {
        addEvent(cc, "system", `Warning: documents are dated ${formatDate(printed)} but signing completed on ${formatDate(today)}. Decide whether to regenerate and resend.`);
      }
    });
  } catch (err) {
    await deleteFile(lock).catch(() => {});
    throw err;
  }
  try {
    await sendClientEmail(id, "A", by);
  } catch (err) {
    console.error("[cases] email A failed", id, (err as Error).message);
    await mutateCase(id, by, (cc) => addEvent(cc, "system", `Email A could not be sent: ${(err as Error).message.slice(0, 200)}`));
    await notifyAdmins(`${id}: email A failed`, [`Signing for case ${id} is complete, but email A could not be sent. Send it from the case page.`], caseLink(id));
  }
  return loadCase(id);
}

export async function revokeSignature(id: string, by: string) {
  const c = await loadCase(id);
  if (!c.boldsign || FINAL_BAD.includes(c.boldsign.status) || c.boldsign.status === "Completed") throw new GuardError("No open envelope to revoke.");
  await boldsign.revokeEnvelope(c.boldsign.documentId, "Revoked by Sterling Pension Group; a corrected version will follow.");
  return mutateCase(id, by, (cc) => {
    if (cc.boldsign) cc.boldsign.status = "Revoked";
    addEvent(cc, by, "BoldSign envelope revoked");
  });
}

/** Allow sending again after decline/expiry/revocation: clears the sent milestone. */
export async function resetSignature(id: string, by: string) {
  return mutateCase(id, by, (cc) => {
    if (!cc.boldsign || !FINAL_BAD.includes(cc.boldsign.status)) throw new GuardError("Only a declined, expired or revoked envelope can be reset.");
    delete cc.milestones.sent_for_signature;
    addEvent(cc, by, "Signature step reset for a new envelope");
  });
}

// ---- Client emails

const EMAIL_MILESTONE = { A: "signed_pack_emailed", B: "award_ecopies_emailed", C: "final_pack_emailed" } as const;

export async function sendClientEmail(id: string, kind: EmailKind, by: string) {
  requireSendAllowed();
  const c = await loadCase(id);
  if (kind === "A") requireMilestones(c, ["signatures_completed"], "Email A");
  if (kind === "B" && !(c.docs.award_letter.notarized ?? []).length) throw new GuardError("Email B needs a notarized Award Letter file.");
  if (kind === "C" && !(c.docs.certificate.notarized ?? []).length) throw new GuardError("Email C needs a notarized Certificate file.");
  const draft = buildEmail(c, kind);
  if (draft.problems.length) throw new GuardError(draft.problems.join(" "));
  const attachments = [];
  for (const f of draft.attachments) {
    const bytes = await getFileBytes(f.path);
    if (!bytes) throw new GuardError(`Attachment ${f.name} could not be read.`);
    attachments.push({ filename: f.name, bytes });
  }
  const sent = await sendEmail({ to: draft.to, subject: draft.subject, html: draft.html, text: draft.text, attachments, clientFacing: true });
  return mutateCase(id, by, (cc) => {
    cc.emails.push({
      kind,
      to: sent.to,
      subject: draft.subject,
      sentAt: nowIso(),
      resendId: sent.ids.join(","),
      attachments: draft.attachments.map((a) => a.name),
      by,
      ...(sent.redirectedFrom ? { redirectedFrom: sent.redirectedFrom } : {}),
    });
    if (kind !== "tracking") setMilestone(cc, EMAIL_MILESTONE[kind], by);
    addEvent(cc, by, `Email ${kind} sent${sent.redirectedFrom ? ` (TEST: to ${sent.to.join(", ")} instead of ${sent.redirectedFrom.join(", ")})` : ""}${sent.parts > 1 ? ` in ${sent.parts} parts` : ""}`);
  });
}
