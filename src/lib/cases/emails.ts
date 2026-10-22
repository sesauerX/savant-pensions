// Client emails in English and German. Wording pending owner approval (shown in the settings view).
//
// Rules for every client email: name no party that might receive the documents (no banks,
// consulates, authorities, countries or visas), plain factual tone, no email addresses in the
// body; clients reply to the email itself (reply-to is the intake address, which files replies to
// the case by reference). Documents stay English; German emails give
// the English title first with the German name in brackets.
import { fileById } from "./cases";
import type { Lang } from "./mail";
import { formatDate, formatDateDe } from "./schema";
import { FIELD_BY_KEY } from "./schema";
import { escapeHtml } from "./templates/render";
import { formatAmount, formatUsdDe } from "./words";
import type { Case, CaseFile, CertIssue, DocKey } from "./types";

export type EmailKind = "A" | "B" | "C" | "tracking" | "details";
export type EmailOptions = { certNo?: number; items?: string[]; lang?: Lang };

export type EmailDraft = {
  kind: EmailKind;
  lang: Lang;
  to: string[];
  subject: string;
  html: string;
  text: string;
  attachments: CaseFile[];
  problems: string[];
};

/** Owner decisions on the wording (21 Oct 2026): German approved, English pending. */
export const EMAIL_APPROVAL: Record<Lang, { approved: boolean; note: string }> = {
  de: { approved: true, note: "approved by the owner, 21 Oct 2026; reply footer, missing-details reply sentence (21 Oct) and certificate reply sentence (22 Oct) added afterwards on the owner's instruction" },
  en: { approved: false, note: "wording pending owner approval" },
};

export const EMAIL_TEMPLATES: { kind: EmailKind; name: string }[] = [
  { kind: "A", name: "A · Your pension documents (after signing)" },
  { kind: "B", name: "B · Notarized and apostilled Award Letter" },
  { kind: "C", name: "Certificate C{n} (per certificate issue)" },
  { kind: "tracking", name: "Courier tracking update" },
  { kind: "details", name: "Request missing details" },
];
export const EMAIL_WORDING_STATUS = "wording pending owner approval";

export const CARRIERS = ["DHL", "FedEx", "UPS", "Other"] as const;

export function trackingUrl(carrier: string, tracking: string) {
  const n = encodeURIComponent(tracking.trim());
  switch (carrier) {
    case "DHL": return `https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=${n}`;
    case "FedEx": return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
    case "UPS": return `https://www.ups.com/track?tracknum=${n}`;
    default: return undefined;
  }
}

/** Fields a client can be asked for in the missing-details email. */
export const ASKABLE_FIELDS = Object.values(FIELD_BY_KEY).filter((f) => f.ask).map((f) => f.key);

// ---- helpers

const f = (c: Case, k: string) => String(c.fields[k] ?? "");
const caseLang = (c: Case): Lang => (c.fields.client_language === "de" ? "de" : "en");

function date(iso: string, lang: Lang) {
  try {
    return lang === "de" ? formatDateDe(iso) : formatDate(iso);
  } catch {
    return iso;
  }
}

function usd(amount: string, lang: Lang) {
  try {
    return lang === "de" ? formatUsdDe(amount) : `USD ${formatAmount(amount)}`;
  } catch {
    return amount;
  }
}

const oneLine = (s: string) => s.split(/\n+/).map((x) => x.trim().replace(/,$/, "")).filter(Boolean).join(", ");

function greeting(c: Case, lang: Lang) {
  const sal = f(c, "beneficiary_salutation");
  const sur = f(c, "beneficiary_surname");
  const same = f(c, "member_name") === f(c, "beneficiary_name");
  const name = f(c, "member_name") || (lang === "de" ? "Mandant" : "Client");
  if (lang === "de") {
    if (same && sur && sal === "Ms.") return `Sehr geehrte Frau ${sur},`;
    if (same && sur && sal === "Mr.") return `Sehr geehrter Herr ${sur},`;
    return `Guten Tag ${name},`;
  }
  return same && sal && sur ? `Dear ${sal} ${sur},` : `Dear ${name},`;
}

const signOff = (lang: Lang) => (lang === "de" ? ["Mit freundlichen Grüßen", "Sterling Pension Group"] : ["Kind regards,", "Sterling Pension Group"]);

/** A body: paragraphs (strings), numbered lists, bullet lists and summary tables. */
type Block = string | { ol: string[] } | { ul: string[] } | { table: [string, string][] } | { html: string; text: string };

function render(blocks: Block[], lang: Lang) {
  const all: Block[] = [...blocks, signOff(lang).join("\n")];
  const html = all
    .map((b) => {
      if (typeof b === "string") return `<p style="margin:0 0 12px">${escapeHtml(b).replace(/\n/g, "<br>")}</p>`;
      if ("ol" in b) return `<ol style="margin:0 0 14px;padding-left:22px">${b.ol.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ol>`;
      if ("ul" in b) return `<ul style="margin:0 0 14px;padding-left:22px">${b.ul.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`;
      if ("table" in b)
        return `<table style="border-collapse:collapse;width:100%;margin:4px 0 16px;font-size:14px">${b.table
          .map(([k, v]) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #DCE3EC;color:#5B6776;width:42%">${escapeHtml(k)}</td><td style="padding:6px 10px;border-bottom:1px solid #DCE3EC;color:#0B2545;font-weight:600">${escapeHtml(v)}</td></tr>`)
          .join("")}</table>`;
      return b.html;
    })
    .join("\n");
  const text = all
    .map((b) => {
      if (typeof b === "string") return b;
      if ("ol" in b) return b.ol.map((x, i) => `${i + 1}. ${x}`).join("\n");
      if ("ul" in b) return b.ul.map((x) => `• ${x}`).join("\n");
      if ("table" in b) return b.table.map(([k, v]) => `${k}: ${v}`).join("\n");
      return b.text;
    })
    .join("\n\n");
  return { html, text };
}

// ---- which file is the "latest version" of each document

const fileList = (c: Case, ids: (string | undefined)[]) => ids.map((id) => fileById(c, id)).filter(Boolean) as CaseFile[];

/** Latest version for the client: notarized/apostille e-copies if any, else the e-signed copy. */
function latestDoc(c: Case, doc: Exclude<DocKey, "certificate">): CaseFile[] {
  const notarized = fileList(c, c.docs[doc].notarized ?? []);
  if (notarized.length) return notarized;
  return fileList(c, [c.docs[doc].signed]);
}

function latestCert(c: Case, cert: CertIssue): CaseFile[] {
  const notarized = fileList(c, cert.files.notarized);
  if (notarized.length) return notarized;
  return fileList(c, [cert.files.signed]);
}

// ---- courier wording

function shipmentLines(c: Case, match: (s: Case["shipments"][number]) => boolean, lang: Lang, ifNone: boolean) {
  const s = [...c.shipments].reverse().find(match);
  const address = oneLine(f(c, "beneficiary_address"));
  if (!s) {
    if (!ifNone) return null;
    return lang === "de"
      ? `Die Originale werden per Kurier an ${address} versandt. Die Sendungsdaten erhalten Sie, sobald sie vorliegen.`
      : `The originals will be sent by courier to ${address}. Tracking details will follow.`;
  }
  const url = s.trackingUrl ? ` (${s.trackingUrl})` : "";
  return lang === "de"
    ? `Die Originale wurden am ${date(s.shippedAt, lang)} per ${s.carrier} an ${address} versandt. Sendungsnummer: ${s.tracking}${url}.`
    : `The originals were sent by ${s.carrier} on ${date(s.shippedAt, lang)} to ${address}. Tracking number: ${s.tracking}${url}.`;
}

// ---- titles

const DOC_TITLES: Record<Lang, Record<Exclude<DocKey, "certificate">, string>> = {
  en: {
    operating_agreement: "Operating Agreement",
    pension_policy: "Corporate Pension Policy and Retirement Income Plan",
    written_consent: "Written Consent of the Sole Member",
    award_letter: "Pension Award Letter",
  },
  de: {
    operating_agreement: "Operating Agreement (Gesellschaftsvertrag)",
    pension_policy: "Corporate Pension Policy and Retirement Income Plan (Pensionsordnung)",
    written_consent: "Written Consent of the Sole Member (Gesellschafterbeschluss)",
    award_letter: "Pension Award Letter (Pensionszusage)",
  },
};

// ---- the emails

export function buildEmail(c: Case, kind: EmailKind, opts: EmailOptions = {}): EmailDraft {
  const lang = opts.lang ?? caseLang(c);
  const de = lang === "de";
  const ref = c.id;
  const to = [f(c, "member_email")].filter(Boolean);
  const problems: string[] = [];
  if (!to.length) problems.push("The member email is missing.");
  const hello = greeting(c, lang);
  const company = f(c, "company_name");
  const commencement = date(f(c, "commencement_date"), lang);
  const courierAddress = oneLine(f(c, "beneficiary_address"));
  const done = (subject: string, blocks: Block[], attachments: CaseFile[]): EmailDraft => ({ kind, lang, to, subject, ...render([hello, ...blocks], lang), attachments, problems });

  if (kind === "A") {
    const c1 = c.certificates.find((x) => x.no === 1);
    const signed = [
      ...fileList(c, (["operating_agreement", "pension_policy", "written_consent", "award_letter"] as const).map((d) => c.docs[d].signed)),
      ...(c1 ? fileList(c, [c1.files.signed]) : []),
    ];
    if (signed.length < 5) problems.push("Not all five signed documents are stored yet.");
    const audit = c.files.filter((x) => x.kind === "audit_trail" && !x.certNo).at(-1);
    const survivor = c.fields.has_survivor ? `${de ? "Ja" : "Yes"}, ${f(c, "survivor_name")}` : de ? "Keine" : "None";
    const table: [string, string][] = de
      ? [["Gesellschaft", company], ["Begünstigte(r)", f(c, "beneficiary_name")], ["Monatlicher Betrag", usd(f(c, "monthly_amount"), lang)], ["Erste Zahlung", commencement], ["Hinterbliebenenrente", survivor]]
      : [["Company", company], ["Beneficiary", f(c, "beneficiary_name")], ["Monthly amount", usd(f(c, "monthly_amount"), lang)], ["First payment date", commencement], ["Survivor", survivor]];
    const docs = [...Object.values(DOC_TITLES[lang]), de ? "Certificate of Pension Administration Nr. C1 (Bescheinigung der Pensionsverwaltung)" : "Certificate of Pension Administration (no. C1)"];
    const blocks: Block[] = de
      ? [
          `Ihre Pensionsvereinbarung mit der ${company} wurde unterzeichnet. Anbei erhalten Sie die elektronisch unterzeichneten Exemplare folgender Dokumente:`,
          { ol: docs },
          { table },
          `Zur Bescheinigung: Als Planverwalter können wir nur Tatsachen bescheinigen, die bereits eingetreten sind. Die Bescheinigung Nr. C1 bestätigt daher, dass die Pension zugesagt wurde und die erste Zahlung am ${commencement} fällig ist. Zahlungen kann sie noch nicht bestätigen.`,
          "Erfahrungsgemäß möchte jede Stelle, die Ihre Pensionsunterlagen prüft, in der Regel auch Kontoauszüge sehen, aus denen der tatsächliche Eingang der Zahlungen hervorgeht. Wir empfehlen Ihnen, vorab zu klären, welche Nachweise dort benötigt werden. Sobald Zahlungen erfolgt sind, können Sie bei uns eine aktualisierte Bescheinigung anfordern. Diese stellen wir aus, nachdem wir Nachweise über die Zahlungen erhalten haben, zum Beispiel Kontoauszüge des Pensionsfondskontos oder Ihres Empfängerkontos.",
          `Nächste Schritte: Die Pensionszusage wird notariell beglaubigt und mit einer Apostille versehen. Sie erhalten elektronische Kopien per E-Mail und die Originale per Kurier an ${courierAddress}.`,
        ]
      : [
          `Your pension arrangement with ${company} has been signed. Attached are electronically signed copies of:`,
          { ol: docs },
          { table },
          `About the certificate. As plan administrator we can only certify facts that have already happened. Certificate C1 therefore confirms that the pension has been awarded and that the first payment is due on ${commencement}; it cannot confirm any payments yet.`,
          "In our experience, anyone who reviews your pension documents will usually also want to see bank statements showing the payments actually being received. We recommend that you clarify with them what they need. Once payments have been made, you can request an updated certificate from us. We will issue it after we have seen evidence of the payments, such as statements from the Designated Fund account or from your receiving account.",
          `Next steps: the Pension Award Letter will be notarized and apostilled. You will receive electronic copies by email, and the originals by courier at ${courierAddress}.`,
        ];
    return done(de ? `${ref} – Ihre Pensionsunterlagen` : `${ref} – Your pension documents`, blocks, [...signed, ...(audit ? [audit] : [])]);
  }

  if (kind === "B") {
    const files = fileList(c, c.docs.award_letter.notarized ?? []);
    if (!files.length) problems.push("No notarized Award Letter is stored yet.");
    const shipment = shipmentLines(c, (s) => s.contents.includes("award_letter"), lang, false);
    const blocks: Block[] = de
      ? [
          `anbei erhalten Sie die elektronischen Kopien Ihrer notariell beglaubigten und mit Apostille versehenen Pensionszusage (Pension Award Letter). ${shipment ?? `Die Originale werden per Kurier an ${courierAddress} versandt.`}`,
          "Die Pensionszusage bestätigt die Bedingungen Ihrer Pension, jedoch keine Zahlungen. Der Zahlungsverlauf wird gesondert durch unsere Bescheinigung der Pensionsverwaltung bestätigt, die wir ausstellen können, sobald Zahlungen erfolgt sind.",
        ]
      : [
          "Please find attached the electronic copies of your notarized and apostilled Pension Award Letter.",
          shipment ?? `The originals will be sent by courier to ${courierAddress}. Tracking details will follow.`,
          "The Pension Award Letter confirms the terms of your pension; it does not confirm payments. Payment history is confirmed separately by our Certificate of Pension Administration, which we can issue once payments have been made.",
        ];
    return done(de ? `${ref} – Notariell beglaubigte Pensionszusage mit Apostille` : `${ref} – Notarized and apostilled Pension Award Letter`, blocks, files);
  }

  if (kind === "C") {
    const cert = c.certificates.find((x) => x.no === Number(opts.certNo));
    if (!cert) {
      problems.push("Choose a certificate.");
      return done(`${ref} – Certificate`, [], []);
    }
    const ecopies = latestCert(c, cert);
    if (!ecopies.length) problems.push(`Certificate C${cert.no} has no signed or notarized copy yet.`);
    const others = [...latestDoc(c, "operating_agreement"), ...latestDoc(c, "pension_policy"), ...latestDoc(c, "written_consent"), ...latestDoc(c, "award_letter")];
    const certDate = date(cert.certificate_date, lang);
    const n = cert.payments_made ?? 0;
    const position = de
      ? cert.variant === "onboarding"
        ? "Sie bestätigt die Pensionszusage; zu diesem Datum war noch keine Zahlung fällig."
        : `Sie bestätigt den Stand zu diesem Datum, einschließlich ${n} monatlicher Zahlung(en) seit dem ${commencement}.`
      : cert.variant === "onboarding"
        ? "It confirms the award; no payment had fallen due at that date."
        : `It confirms the position as at that date, including ${n} monthly payment(s) since ${commencement}.`;
    const shipment = shipmentLines(c, (s) => s.certNo === cert.no, lang, false);
    const blocks: Block[] = de
      ? [
          `anbei erhalten Sie die Bescheinigung der Pensionsverwaltung (Certificate of Pension Administration) Nr. C${cert.no} vom ${certDate}. ${position}`,
          ...(shipment ? [shipment] : []),
          "Wie bereits erwähnt: Stellen, die diese Bescheinigung prüfen, möchten in der Regel auch Kontoauszüge über die erhaltenen Zahlungen sehen. Eine Bescheinigung gibt nur den Stand zu ihrem Datum wieder. Wenn Sie später eine aktualisierte Bescheinigung benötigen, antworten Sie bitte auf diese E-Mail, behalten Sie die Referenz im Betreff bei und fügen Sie Nachweise über die seit dieser Bescheinigung erfolgten Zahlungen bei (zum Beispiel Kontoauszüge).",
        ]
      : [
          `Attached is Certificate of Pension Administration no. C${cert.no}, dated ${certDate}. ${position}`,
          ...(shipment ? [shipment] : []),
          "As before: anyone reviewing this certificate will usually also want to see bank statements showing the payments received. A certificate only reflects the facts as at its date. If you need an updated certificate later, please reply to this email, keeping the reference in the subject line, and attach evidence of the payments made since this certificate (for example bank statements).",
        ];
    return done(de ? `${ref} – Bescheinigung der Pensionsverwaltung Nr. C${cert.no}` : `${ref} – Certificate of Pension Administration C${cert.no}`, blocks, [...ecopies, ...others]);
  }

  if (kind === "details") {
    const items = (opts.items ?? []).map((k) => FIELD_BY_KEY[k]?.ask?.[lang]).filter(Boolean) as string[];
    if (!items.length) problems.push("Choose at least one missing detail.");
    const blocks: Block[] = de
      ? [
          "um Ihre Unterlagen fertigstellen zu können, benötigen wir noch folgende Angaben:",
          { ul: items },
          `Bitte antworten Sie direkt auf diese E-Mail mit den Angaben und fügen Sie gegebenenfalls Scans bei. Behalten Sie dabei die Referenz ${ref} im Betreff bei.`,
        ]
      : [
          "To complete your documents, we still need the following details:",
          { ul: items },
          `Please reply to this email with the details and attach any scans. Keep the reference ${ref} in the subject line.`,
        ];
    return done(de ? `${ref} – Fehlende Angaben zu Ihrer Pensionsvereinbarung` : `${ref} – Missing details for your pension arrangement`, blocks, []);
  }

  // Tracking update for the latest shipment
  const s = c.shipments.at(-1);
  if (!s) problems.push("No shipment recorded.");
  const what = s
    ? s.certNo
      ? de
        ? `Certificate of Pension Administration Nr. C${s.certNo} (Bescheinigung der Pensionsverwaltung)`
        : `Certificate of Pension Administration C${s.certNo}`
      : s.contents.filter((d) => d !== "certificate").map((d) => DOC_TITLES[lang][d as Exclude<DocKey, "certificate">]).join(", ")
    : "";
  const line = s ? shipmentLines(c, (x) => x.id === s.id, lang, true)! : "";
  const blocks: Block[] = de ? [`Ihre Originaldokumente sind unterwegs: ${what}.`, line] : [`The originals of your documents are on their way: ${what}.`, line];
  return done(de ? `${ref} – Sendungsverfolgung für Ihre Originaldokumente` : `${ref} – Courier tracking for your original documents`, blocks, []);
}
