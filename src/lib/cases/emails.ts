// Client emails A, B, C and tracking updates (spec §9). Draft wording, pending owner approval.
import { DOCS } from "./documents";
import { fileById } from "./cases";
import { formatDate } from "./schema";
import { escapeHtml } from "./templates/render";
import { formatAmount } from "./words";
import type { Case, CaseFile, DocKey } from "./types";

export type EmailKind = "A" | "B" | "C" | "tracking";

export type EmailDraft = {
  kind: EmailKind;
  to: string[];
  subject: string;
  html: string;
  text: string;
  attachments: CaseFile[];
  problems: string[];
};

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

const f = (c: Case, k: string) => String(c.fields[k] ?? "");
const date = (iso: string) => {
  try {
    return formatDate(iso);
  } catch {
    return iso;
  }
};

function greeting(c: Case) {
  const sal = f(c, "beneficiary_salutation");
  const sur = f(c, "beneficiary_surname");
  return sal && sur && f(c, "member_name") === f(c, "beneficiary_name") ? `Dear ${sal} ${sur},` : `Dear ${f(c, "member_name") || "Client"},`;
}

function shipmentFor(c: Case, doc: DocKey) {
  return [...c.shipments].reverse().find((s) => s.contents.includes(doc));
}

function courierLines(c: Case, doc: DocKey): { text: string; html: string } {
  const s = shipmentFor(c, doc);
  const address = f(c, "beneficiary_address").replace(/\n+/g, ", ");
  if (!s) return { text: `The originals will be sent by courier to ${address}. Tracking details will follow.`, html: `<p>The originals will be sent by courier to ${escapeHtml(address)}. Tracking details will follow.</p>` };
  const link = s.trackingUrl ? ` (${s.trackingUrl})` : "";
  return {
    text: `The originals were sent by ${s.carrier} on ${date(s.shippedAt)} to ${address}. Tracking number: ${s.tracking}${link}.`,
    html: `<p>The originals were sent by ${escapeHtml(s.carrier)} on ${escapeHtml(date(s.shippedAt))} to ${escapeHtml(address)}.<br>Tracking number: ${s.trackingUrl ? `<a href="${escapeHtml(s.trackingUrl)}">${escapeHtml(s.tracking)}</a>` : escapeHtml(s.tracking)}</p>`,
  };
}

function table(rows: [string, string][]) {
  return `<table style="border-collapse:collapse;width:100%;margin:12px 0 18px;font-size:14px">${rows
    .map(([k, v]) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #DCE3EC;color:#5B6776;width:42%">${escapeHtml(k)}</td><td style="padding:6px 10px;border-bottom:1px solid #DCE3EC;color:#0B2545;font-weight:600">${escapeHtml(v)}</td></tr>`)
    .join("")}</table>`;
}

const textTable = (rows: [string, string][]) => rows.map(([k, v]) => `${k}: ${v}`).join("\n");

function signedFiles(c: Case) {
  return (["operating_agreement", "pension_policy", "written_consent"] as DocKey[]).map((k) => fileById(c, c.docs[k].signed));
}

function notarizedFiles(c: Case, doc: DocKey) {
  return (c.docs[doc].notarized ?? []).map((id) => fileById(c, id)).filter(Boolean) as CaseFile[];
}

export function buildEmail(c: Case, kind: EmailKind): EmailDraft {
  const ref = c.id;
  const to = [f(c, "member_email")].filter(Boolean);
  const problems: string[] = [];
  if (!to.length) problems.push("The member email is missing.");
  const sign = `<p style="margin-top:22px">Kind regards,<br>Sterling Pension Group</p>`;
  const signText = "Kind regards,\nSterling Pension Group";
  const hello = greeting(c);

  if (kind === "A") {
    const files = signedFiles(c);
    const audit = c.files.filter((x) => x.kind === "audit_trail").at(-1);
    if (files.some((x) => !x)) problems.push("Signed documents are not all stored yet.");
    const rows: [string, string][] = [
      ["Company", f(c, "company_name")],
      ["Beneficiary", f(c, "beneficiary_name")],
      ["Monthly pension", c.fields.monthly_amount ? `USD ${formatAmount(f(c, "monthly_amount"))}` : ""],
      ["Commencement date", c.fields.commencement_date ? date(f(c, "commencement_date")) : ""],
      ["Survivor pension", c.fields.has_survivor ? `Yes, ${f(c, "survivor_name")}` : "No"],
    ];
    const next = `The Pension Award Letter will be notarized and apostilled. You will receive electronic copies by email and the originals by courier at ${f(c, "beneficiary_address").replace(/\n+/g, ", ")}.`;
    return {
      kind,
      to,
      subject: `${ref} – Your signed corporate documents`,
      html: `<p>${escapeHtml(hello)}</p><p>Your corporate documents for ${escapeHtml(f(c, "company_name"))} have been signed by all parties. The signed copies and the signing certificate are attached.</p>${table(rows)}<p><strong>Next steps</strong></p><p>${escapeHtml(next)}</p>${sign}`,
      text: `${hello}\n\nYour corporate documents for ${f(c, "company_name")} have been signed by all parties. The signed copies and the signing certificate are attached.\n\n${textTable(rows)}\n\nNext steps\n${next}\n\n${signText}`,
      attachments: [...(files.filter(Boolean) as CaseFile[]), ...(audit ? [audit] : [])],
      problems,
    };
  }

  if (kind === "B") {
    const files = notarizedFiles(c, "award_letter");
    if (!files.length) problems.push("No notarized Award Letter is stored yet.");
    const courier = courierLines(c, "award_letter");
    return {
      kind,
      to,
      subject: `${ref} – Notarized and apostilled Pension Award Letter`,
      html: `<p>${escapeHtml(hello)}</p><p>Please find attached the electronic copies of your notarized and apostilled Pension Award Letter.</p>${courier.html}${sign}`,
      text: `${hello}\n\nPlease find attached the electronic copies of your notarized and apostilled Pension Award Letter.\n\n${courier.text}\n\n${signText}`,
      attachments: files,
      problems,
    };
  }

  if (kind === "C") {
    const cert = notarizedFiles(c, "certificate");
    const award = notarizedFiles(c, "award_letter");
    const signed = signedFiles(c);
    if (!cert.length) problems.push("No notarized Certificate is stored yet.");
    if (!award.length) problems.push("No notarized Award Letter is stored.");
    if (signed.some((x) => !x)) problems.push("Signed corporate documents are missing.");
    const courier = courierLines(c, "certificate");
    const list = ["Operating Agreement (signed)", "Corporate Pension Policy (signed)", "Written Consent of Sole Member (signed)", "Pension Award Letter (notarized and apostilled)", "Certificate of Pension Administration (notarized and apostilled)"];
    return {
      kind,
      to,
      subject: `${ref} – Certificate of Pension Administration and complete document set`,
      html: `<p>${escapeHtml(hello)}</p><p>Please find attached the notarized and apostilled Certificate of Pension Administration, together with the complete set of your documents:</p><ol>${list.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ol>${courier.html}${sign}`,
      text: `${hello}\n\nPlease find attached the notarized and apostilled Certificate of Pension Administration, together with the complete set of your documents:\n${list.map((l, i) => `${i + 1}. ${l}`).join("\n")}\n\n${courier.text}\n\n${signText}`,
      attachments: [...(signed.filter(Boolean) as CaseFile[]), ...award, ...cert],
      problems,
    };
  }

  // Tracking update for the latest shipment
  const s = c.shipments.at(-1);
  if (!s) problems.push("No shipment recorded.");
  const what = s ? s.contents.map((d) => DOCS[d].title).join(" and ") : "";
  const courier = s ? courierLines(c, s.contents[0]) : { text: "", html: "" };
  return {
    kind,
    to,
    subject: `${ref} – Courier tracking for your original documents`,
    html: `<p>${escapeHtml(hello)}</p><p>The original ${escapeHtml(what)} ${s && s.contents.length > 1 ? "are" : "is"} on the way.</p>${courier.html}${sign}`,
    text: `${hello}\n\nThe original ${what} ${s && s.contents.length > 1 ? "are" : "is"} on the way.\n\n${courier.text}\n\n${signText}`,
    attachments: [],
    problems,
  };
}
