// Case workflow steps shared by admin actions, webhooks and cron.
import * as boldsign from "./boldsign";
import { addEvent, getCase, mutateCase, nowIso, setMilestone, storeFile } from "./cases";
import { config } from "./config";
import type { CertificateValues } from "./derive";
import { DOCS, ENVELOPE_DOCS, INITIAL_DOCS, certRef, docFileName, renderDocuments, type DocKey, type RenderItem } from "./documents";
import { buildEmail, type EmailKind, type EmailOptions } from "./emails";
import { sendEmail, notifyAdmins } from "./mail";
import { GuardError, requireActive, requireMilestones } from "./milestones";
import { fieldError, FIELD_BY_KEY, formatDate, isIsoDate, missingFields, todayIso } from "./schema";
import { getFileBytes, writeJson, deleteFile } from "./store";
import type { Case, CaseFile, CertIssue } from "./types";

const caseLink = (id: string) => `${config.siteUrl()}/admin/cases/${id}`;
const FINAL_BAD = ["Declined", "Expired", "Revoked"];

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

// ---- Certificates

export const certByNo = (c: Case, no: number) => c.certificates.find((x) => x.no === no);

function certValues(cert: Pick<CertIssue, "variant" | "certificate_date" | "payments_made" | "last_payment_date">): CertificateValues {
  return { variant: cert.variant, certificate_date: cert.certificate_date, payments_made: cert.payments_made, last_payment_date: cert.last_payment_date };
}

const certItem = (cert: CertIssue, withTags = false): RenderItem => ({ doc: "certificate", certNo: cert.no, withTags, certificate: certValues(cert) });

/** Paragraph 5 must be true on the certificate date. */
export function certDateGuard(variant: CertIssue["variant"], certificateDate: string, commencement: unknown) {
  if (!isIsoDate(certificateDate)) throw new GuardError("Enter a valid certificate date.");
  const start = String(commencement ?? "");
  if (!isIsoDate(start)) throw new GuardError("The first payment date (commencement) is missing.");
  if (variant === "onboarding" && certificateDate >= start) {
    throw new GuardError(`An onboarding certificate must be dated before the first payment date (${formatDate(start)}); from then on issue a payment-history certificate.`);
  }
  if (variant === "payment_history" && certificateDate < start) {
    throw new GuardError(`A payment-history certificate cannot be dated before the first payment date (${formatDate(start)}).`);
  }
}

const monthIndex = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;

export function paymentHistoryGuard(input: { certificate_date: string; payments_made: number; last_payment_date: string }, commencement: unknown) {
  certDateGuard("payment_history", input.certificate_date, commencement);
  const start = String(commencement);
  if (!Number.isInteger(input.payments_made) || input.payments_made < 1) throw new GuardError("Enter the number of payments made (at least 1).");
  if (!isIsoDate(input.last_payment_date)) throw new GuardError("Enter the date of the most recent payment.");
  if (input.last_payment_date < start) throw new GuardError("The most recent payment cannot be before the first payment date.");
  if (input.last_payment_date > input.certificate_date) throw new GuardError("The most recent payment cannot be after the certificate date.");
  if (input.last_payment_date > todayIso()) throw new GuardError("The most recent payment cannot be in the future.");
  const maxMonthly = monthIndex(input.last_payment_date) - monthIndex(start) + 1;
  if (input.payments_made > maxMonthly) {
    throw new GuardError(`${input.payments_made} monthly payments do not fit between ${formatDate(start)} and ${formatDate(input.last_payment_date)} (at most ${maxMonthly}).`);
  }
}

// ---- Documents

/**
 * Render and store the current (unsigned, untagged) versions of documents 1–4 and/or
 * certificate issues.
 */
export async function generateDocuments(id: string, by: string, opts: { docs?: DocKey[]; certNos?: number[] } = {}) {
  const docs = (opts.docs ?? INITIAL_DOCS).filter((d) => d !== "certificate");
  const certNos = opts.certNos ?? [];
  const c = await loadCase(id);
  if (c.state === "on_hold" || c.state === "cancelled") requireActive(c);
  requireMilestones(c, ["details_confirmed"], "Generating documents");
  const problems = fieldProblems(c);
  if (problems.length) throw new GuardError(problems.join(" · "));
  const certs = certNos.map((no) => {
    const cert = certByNo(c, no);
    if (!cert) throw new GuardError(`Certificate C${no} not found.`);
    certDateGuard(cert.variant, cert.certificate_date, c.fields.commencement_date);
    return cert;
  });
  const items: RenderItem[] = [...docs, ...certs.map((cert) => certItem(cert))];
  if (!items.length) return c;
  const rendered = await renderDocuments(items, c.fields, c.id);
  const stored: CaseFile[] = [];
  for (const r of rendered) {
    stored.push(await storeFile(c.id, { bytes: r.pdf, name: r.name, kind: "draft", contentType: "application/pdf", by, doc: r.doc, templateVersion: r.version, pages: r.pages, certNo: r.certNo }));
  }
  return mutateCase(c.id, by, (cc) => {
    for (const f of stored) {
      cc.files.push(f);
      if (f.doc === "certificate") {
        const cert = certByNo(cc, f.certNo!)!;
        if (cert.files.current) cert.files.history.push(cert.files.current);
        cert.files.current = f.id;
      } else {
        const rec = cc.docs[f.doc!];
        if (rec.current) rec.history.push(rec.current);
        rec.current = f.id;
      }
    }
    if (INITIAL_DOCS.every((d) => cc.docs[d].current) && certByNo(cc, 1)?.files.current) setMilestone(cc, "documents_generated", by);
    const names = stored.map((f) => `${f.doc === "certificate" ? `Certificate C${f.certNo}` : DOCS[f.doc!].short} (${f.templateVersion})`).join(", ");
    addEvent(cc, by, `Generated ${names}${config.templatesApproved() ? "" : " with DRAFT watermark"}`);
  });
}

function newIssue(c: Case, init: Omit<CertIssue, "no" | "ref" | "createdAt" | "files" | "shipments">): CertIssue {
  const no = Math.max(0, ...c.certificates.map((x) => x.no)) + 1;
  return { no, ref: certRef(c.id, no), createdAt: nowIso(), files: { notarized: [], history: [], proof: [] }, shipments: [], ...init };
}

/** Regenerate documents 1–4, and C1 while it is unsigned (kept dated on the signing date). */
export async function regenerateInitial(id: string, by: string) {
  const c = await loadCase(id);
  const c1 = certByNo(c, 1);
  const syncC1 = Boolean(c1 && !c1.files.signed);
  if (c1 && syncC1 && c1.certificate_date !== c.fields.signing_date) {
    certDateGuard("onboarding", String(c.fields.signing_date), c.fields.commencement_date);
    await mutateCase(id, by, (cc) => {
      certByNo(cc, 1)!.certificate_date = String(cc.fields.signing_date);
    });
  }
  return generateDocuments(id, by, { docs: INITIAL_DOCS, certNos: syncC1 ? [1] : [] });
}

export async function confirmDetails(id: string, by: string) {
  const c = await loadCase(id);
  requireActive(c);
  const problems = fieldProblems(c);
  if (problems.length) throw new GuardError(problems.join(" · "));
  // C1 (onboarding) is dated on the signing date and must predate the first payment.
  certDateGuard("onboarding", String(c.fields.signing_date), c.fields.commencement_date);
  await mutateCase(id, by, (cc) => {
    setMilestone(cc, "received", by);
    setMilestone(cc, "details_confirmed", by);
    if (!certByNo(cc, 1)) {
      cc.certificates.push(newIssue(cc, { variant: "onboarding", certificate_date: String(cc.fields.signing_date), by }));
    }
    addEvent(cc, by, "Details confirmed; certificate C1 (onboarding) created");
  });
  return generateDocuments(id, by, { docs: INITIAL_DOCS, certNos: [1] });
}

/** A later certificate issue reporting verified payments. */
export async function issuePaymentCertificate(
  id: string,
  by: string,
  input: { certificate_date: string; payments_made: number; last_payment_date: string; attested: boolean },
) {
  const c = await loadCase(id);
  if (c.state === "on_hold" || c.state === "cancelled") throw new GuardError(`This case is ${c.state.replace("_", " ")}.`);
  requireMilestones(c, ["signatures_completed"], "A payment-history certificate");
  if (!input.attested) throw new GuardError("Tick the confirmation that you verified these payments against the Designated Fund bank records.");
  paymentHistoryGuard(input, c.fields.commencement_date);
  let no = 0;
  await mutateCase(id, by, (cc) => {
    const issue = newIssue(cc, {
      variant: "payment_history",
      certificate_date: input.certificate_date,
      payments_made: input.payments_made,
      last_payment_date: input.last_payment_date,
      attestedBy: { name: by, at: nowIso(), text: "I have verified these payments against the Designated Fund bank records" },
      by,
    });
    no = issue.no;
    cc.certificates.push(issue);
    addEvent(cc, by, `Certificate C${issue.no} issued (payment history: ${input.payments_made} payment(s), last ${input.last_payment_date}); payments attested by ${by}`);
  });
  await generateDocuments(id, by, { docs: [], certNos: [no] });
  return no;
}

/** Re-date (optional) and regenerate one certificate issue. */
export async function regenerateCertificate(id: string, by: string, no: number, newDate?: string) {
  const c = await loadCase(id);
  const cert = certByNo(c, no);
  if (!cert) throw new GuardError(`Certificate C${no} not found.`);
  if (newDate && newDate !== cert.certificate_date) {
    certDateGuard(cert.variant, newDate, c.fields.commencement_date);
    if (cert.variant === "payment_history" && cert.last_payment_date && newDate < cert.last_payment_date) {
      throw new GuardError("The certificate date cannot be before the most recent payment it reports.");
    }
    await mutateCase(id, by, (cc) => {
      certByNo(cc, no)!.certificate_date = newDate;
      addEvent(cc, by, `Certificate C${no} re-dated ${newDate}`);
    });
  }
  return generateDocuments(id, by, { docs: [], certNos: [no] });
}

// ---- Main signing envelope: OA, Policy, Consent (client + Sterling), Award Letter and C1 (Sterling)

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
  const c1 = certByNo(c, 1);
  if (!c1) throw new GuardError("Certificate C1 is missing. Regenerate the documents.");
  certDateGuard("onboarding", c1.certificate_date, c.fields.commencement_date);

  // The envelope copies are rendered with signature markers, which give the field positions and
  // are removed from the PDF; the stored copies stay unmarked for the notary.
  const rendered = await renderDocuments(
    ENVELOPE_DOCS.map((doc): RenderItem => (doc === "certificate" ? certItem(c1, true) : { doc, withTags: true })),
    c.fields,
    c.id,
  );
  const files = rendered.map((r) => ({ name: r.name, bytes: r.pdf, pages: r.pages, fields: r.fields }));
  const parts: { doc: DocKey; pages: number; certNo?: number }[] = rendered.map((r) => ({ doc: r.doc, pages: r.pages, ...(r.certNo ? { certNo: r.certNo } : {}) }));
  const realEmail = String(c.fields.member_email);
  const clientEmail = config.live() ? realEmail : config.testRecipient();
  if (!clientEmail) throw new GuardError("TEST_RECIPIENT is not set (test mode).");
  const company = String(c.fields.company_name);
  const documentId = await boldsign.sendEnvelope({
    title: `${c.id} – ${company} – Pension documents`,
    message: `Please review and sign the pension documents of ${company}. Sterling Pension Group LLC signs as Plan Administrator after you.`,
    files,
    signers: [
      { name: String(c.fields.member_name), email: clientEmail },
      { name: config.spgSignerName(), email: config.spgSignerEmail() },
    ],
    tags: boldsign.MAIN_TAGS,
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
    addEvent(cc, by, `Sent 5 documents for signature via BoldSign${config.live() ? "" : ` (TEST: client signer redirected to ${clientEmail})`}`);
  });
}

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

/** Test seam: a local self-test can supply the signed PDF instead of downloading it. */
export type SignedSource = { combined: Uint8Array; audit?: Uint8Array | null };

/** Download, split and store the signed result, then send email A. Idempotent. */
export async function completeSigning(id: string, by: string, source?: SignedSource) {
  const c = await loadCase(id);
  if (!c.boldsign || c.milestones.signatures_completed) return c;
  const lock = `cases/${id}/locks/signing-${c.boldsign.documentId}.json`;
  try {
    await writeJson(lock, { at: nowIso() }, { create: true });
  } catch {
    return c; // another invocation is processing it
  }
  try {
    const combined = source?.combined ?? (await boldsign.downloadSigned(c.boldsign.documentId));
    const split = await boldsign.splitSigned(combined, c.boldsign.parts);
    const audit = source ? (source.audit ?? split.audit) : ((await boldsign.downloadAuditTrail(c.boldsign.documentId)) ?? split.audit);
    const stored: CaseFile[] = [];
    for (const p of split.parts) {
      const name = docFileName(id, p.doc, p.certNo).replace(".pdf", " (signed).pdf");
      stored.push(await storeFile(id, { bytes: p.bytes, name, kind: "signed", contentType: "application/pdf", by, doc: p.doc, pages: p.pages, certNo: p.certNo }));
    }
    const auditFile = audit ? await storeFile(id, { bytes: audit, name: `${id} - Signing certificate (audit trail).pdf`, kind: "audit_trail", contentType: "application/pdf", by }) : null;
    const today = todayIso();
    await mutateCase(id, by, (cc) => {
      if (cc.milestones.signatures_completed) return;
      for (const f of stored) {
        cc.files.push(f);
        if (f.doc === "certificate") certByNo(cc, f.certNo!)!.files.signed = f.id;
        else cc.docs[f.doc!].signed = f.id;
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

// ---- E-signature for later certificate issues (Sterling only)

export async function sendCertificateForSignature(id: string, by: string, no: number) {
  const c = await loadCase(id);
  const cert = certByNo(c, no);
  if (!cert) throw new GuardError(`Certificate C${no} not found.`);
  if (no === 1) throw new GuardError("C1 is signed in the main envelope.");
  if (cert.files.signed) throw new GuardError(`C${no} is already signed.`);
  if (cert.boldsign && !FINAL_BAD.includes(cert.boldsign.status)) throw new GuardError(`C${no} is already out for signature.`);
  if (!config.boldsignKey() || !config.spgSignerEmail()) throw new GuardError("BoldSign is not configured.");
  certDateGuard(cert.variant, cert.certificate_date, c.fields.commencement_date);
  const [r] = await renderDocuments([certItem(cert, true)], c.fields, c.id);
  const documentId = await boldsign.sendEnvelope({
    title: `${cert.ref} – ${String(c.fields.company_name)} – Certificate of Pension Administration`,
    message: `Certificate ${cert.ref} for signature as Plan Administrator.`,
    files: [{ name: r.name, bytes: r.pdf, pages: r.pages, fields: r.fields }],
    signers: [{ name: config.spgSignerName(), email: config.spgSignerEmail() }],
    tags: boldsign.CERT_ONLY_TAGS,
  });
  await writeJson(`boldsign/doc-${documentId.replace(/[^\w-]/g, "")}.json`, { caseId: id, certNo: no });
  return mutateCase(id, by, (cc) => {
    const x = certByNo(cc, no)!;
    x.boldsign = { documentId, status: "Sent", sentAt: nowIso() };
    x.signPages = r.pages;
    addEvent(cc, by, `Certificate C${no} sent to ${config.spgSignerName()} for e-signature`);
  });
}

export async function refreshCertificateSignature(id: string, by: string, no: number) {
  const c = await loadCase(id);
  const cert = certByNo(c, no);
  if (!cert?.boldsign || cert.files.signed) return c;
  const s = await boldsign.getStatus(cert.boldsign.documentId);
  const before = cert.boldsign.status;
  await mutateCase(id, by, (cc) => {
    const x = certByNo(cc, no)!;
    if (!x.boldsign) return;
    x.boldsign.status = s.status;
    x.boldsign.signers = s.signers;
    x.boldsign.lastPolledAt = nowIso();
    if (s.status !== before) addEvent(cc, by, `Certificate C${no} BoldSign status: ${s.status}`);
  });
  if (s.status === "Completed") return completeCertificateSigning(id, by, no);
  return loadCase(id);
}

export async function completeCertificateSigning(id: string, by: string, no: number, source?: SignedSource) {
  const c = await loadCase(id);
  const cert = certByNo(c, no);
  if (!cert?.boldsign || cert.files.signed) return c;
  const lock = `cases/${id}/locks/signing-${cert.boldsign.documentId}.json`;
  try {
    await writeJson(lock, { at: nowIso() }, { create: true });
  } catch {
    return c;
  }
  try {
    const combined = source?.combined ?? (await boldsign.downloadSigned(cert.boldsign.documentId));
    const { PDFDocument } = await import("pdf-lib");
    const pages = cert.signPages ?? (await PDFDocument.load(combined)).getPageCount();
    const split = await boldsign.splitSigned(combined, [{ doc: "certificate", certNo: no, pages }]);
    const f = await storeFile(id, { bytes: split.parts[0].bytes, name: docFileName(id, "certificate", no).replace(".pdf", " (signed).pdf"), kind: "signed", contentType: "application/pdf", by, doc: "certificate", certNo: no, pages });
    const audit = source ? split.audit : ((await boldsign.downloadAuditTrail(cert.boldsign.documentId)) ?? split.audit);
    const auditFile = audit ? await storeFile(id, { bytes: audit, name: `${cert.ref} - Signing certificate (audit trail).pdf`, kind: "audit_trail", contentType: "application/pdf", by, certNo: no }) : null;
    return await mutateCase(id, by, (cc) => {
      const x = certByNo(cc, no)!;
      if (x.files.signed) return;
      cc.files.push(f, ...(auditFile ? [auditFile] : []));
      x.files.signed = f.id;
      if (x.boldsign) {
        x.boldsign.status = "Completed";
        x.boldsign.completedAt = nowIso();
      }
      addEvent(cc, by, `Certificate C${no} e-signed`);
    });
  } catch (err) {
    await deleteFile(lock).catch(() => {});
    throw err;
  }
}

/** Every open envelope of a case (main and certificates), for page polls and cron. */
export async function refreshAllSignatures(id: string, by: string) {
  let c = await loadCase(id);
  if (c.boldsign && !c.milestones.signatures_completed && !FINAL_BAD.includes(c.boldsign.status)) c = await refreshSignature(id, by);
  for (const cert of c.certificates) {
    if (cert.boldsign && !cert.files.signed && !FINAL_BAD.includes(cert.boldsign.status)) c = await refreshCertificateSignature(id, by, cert.no);
  }
  return c;
}

// ---- Client emails

const EMAIL_MILESTONE = { A: "signed_pack_emailed", B: "award_ecopies_emailed" } as const;

export async function sendClientEmail(id: string, kind: EmailKind, by: string, opts: EmailOptions = {}) {
  requireSendAllowed();
  const c = await loadCase(id);
  if (kind === "A") requireMilestones(c, ["signatures_completed"], "Email A");
  if (kind === "B" && !(c.docs.award_letter.notarized ?? []).length) throw new GuardError("Email B needs a notarized Award Letter file.");
  if (kind === "C") {
    const cert = certByNo(c, Number(opts.certNo));
    if (!cert) throw new GuardError("Choose a certificate.");
    if (!cert.files.signed && !cert.files.notarized.length) throw new GuardError(`Certificate C${cert.no} has no signed or notarized copy yet.`);
  }
  // Emails always go out in the case's language; the English toggle is for preview only.
  const draft = buildEmail(c, kind, { ...opts, lang: undefined });
  if (draft.problems.length) throw new GuardError(draft.problems.join(" "));
  const attachments = [];
  for (const f of draft.attachments) {
    const bytes = await getFileBytes(f.path);
    if (!bytes) throw new GuardError(`Attachment ${f.name} could not be read.`);
    attachments.push({ filename: f.name, bytes });
  }
  const sent = await sendEmail({ to: draft.to, subject: draft.subject, html: draft.html, text: draft.text, attachments, clientFacing: true, lang: draft.lang, footer: draft.footer });
  return mutateCase(id, by, (cc) => {
    cc.emails.push({
      kind,
      ...(kind === "C" ? { certNo: Number(opts.certNo) } : {}),
      lang: draft.lang,
      to: sent.to,
      subject: draft.subject,
      sentAt: nowIso(),
      resendId: sent.ids.join(","),
      attachments: draft.attachments.map((a) => a.name),
      by,
      ...(sent.redirectedFrom ? { redirectedFrom: sent.redirectedFrom } : {}),
    });
    if (kind === "A" || kind === "B") setMilestone(cc, EMAIL_MILESTONE[kind], by);
    if (kind === "C") certByNo(cc, Number(opts.certNo))!.emailedAt = nowIso();
    const label = kind === "C" ? `Certificate C${opts.certNo} email` : kind === "details" ? "Missing-details request" : `Email ${kind}`;
    addEvent(cc, by, `${label} sent (${draft.lang})${sent.redirectedFrom ? ` (TEST: to ${sent.to.join(", ")} instead of ${sent.redirectedFrom.join(", ")})` : ""}${sent.parts > 1 ? ` in ${sent.parts} parts` : ""}`);
  });
}
