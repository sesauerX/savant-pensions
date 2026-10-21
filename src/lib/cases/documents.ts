// The five documents: registry, HTML assembly and rendering to PDF.
import oaSrc from "./templates/operating_agreement.html?raw";
import policySrc from "./templates/pension_policy.html?raw";
import consentSrc from "./templates/written_consent.html?raw";
import awardSrc from "./templates/award_letter.html?raw";
import certSrc from "./templates/certificate.html?raw";
import sharedCss from "./templates/shared.css?raw";
import logoSvg from "../../../public/logo.svg?raw";
import { fontFaceCss } from "./fonts";
import { MissingFieldsError, escapeHtml, renderTemplate, templateVersion } from "./templates/render";
import { templateValues, type CertificateValues } from "./derive";
import type { Fields } from "./schema";
import { config } from "./config";

export type DocKey = "operating_agreement" | "pension_policy" | "written_consent" | "award_letter" | "certificate";

export const DOC_KEYS: DocKey[] = ["operating_agreement", "pension_policy", "written_consent", "award_letter", "certificate"];
/** Main BoldSign envelope, in order: documents 1–4 plus certificate C1. */
export const ENVELOPE_DOCS: DocKey[] = ["operating_agreement", "pension_policy", "written_consent", "award_letter", "certificate"];
/** Documents 1–4 (certificates are separate numbered issues). */
export const INITIAL_DOCS: DocKey[] = ["operating_agreement", "pension_policy", "written_consent", "award_letter"];
/** The client signs these; Sterling signs all envelope documents. */
export const CLIENT_SIGNED_DOCS: DocKey[] = ["operating_agreement", "written_consent"];

export const certRef = (caseRef: string, no: number) => `${caseRef}-C${no}`;

/** sterling: Sterling header/footer/border · company: neutral corporate · letter: the client company's own paper */
type DocDef = { n: number; title: string; short: string; src: string; footer: "sterling" | "company" | "letter" };

export const DOCS: Record<DocKey, DocDef> = {
  operating_agreement: { n: 1, title: "Operating Agreement", short: "Operating Agreement", src: oaSrc, footer: "company" },
  pension_policy: { n: 2, title: "Corporate Pension Policy", short: "Pension Policy", src: policySrc, footer: "company" },
  written_consent: { n: 3, title: "Written Consent of Sole Member", short: "Written Consent", src: consentSrc, footer: "company" },
  award_letter: { n: 4, title: "Pension Award Letter", short: "Award Letter", src: awardSrc, footer: "letter" },
  certificate: { n: 5, title: "Certificate of Pension Administration", short: "Certificate", src: certSrc, footer: "sterling" },
};

export const WATERMARK_TEXT = "DRAFT – PENDING COUNSEL REVIEW";
const STERLING_LINE = "Sterling Pension Group LLC · 15 N Main St #100, West Hartford, CT 06107, USA";

export function docFileName(reference: string, doc: DocKey, certNo?: number) {
  return `${reference} - ${DOCS[doc].n} ${DOCS[doc].title}${certNo ? ` C${certNo}` : ""}.pdf`;
}

export function docVersion(doc: DocKey) {
  return templateVersion(DOCS[doc].src);
}

/** Field keys behind a template value name (capital_amount_words -> capital_amount). */
function baseField(name: string) {
  return name.replace(/_(words|lines)$/, "");
}

export class DocumentFieldsError extends Error {
  missing: string[];
  constructor(missing: string[]) {
    super(`Missing fields: ${missing.join(", ")}`);
    this.missing = missing;
  }
}

export type BuiltDoc = { doc: DocKey; html: string; footerHtml: string; version: string; title: string; border: boolean; author: string };

/** Fill a template and wrap it in a full HTML page. Throws DocumentFieldsError with every missing field. */
export function buildDocument(
  doc: DocKey,
  fields: Fields,
  reference: string,
  opts: { watermark?: boolean; withTags?: boolean; certificate?: CertificateValues } = {},
): BuiltDoc {
  const def = DOCS[doc];
  if (doc === "certificate" && !opts.certificate) throw new Error("A certificate needs its issue details");
  const values = templateValues(fields, reference, { showPassport: config.showPassport(), withTags: opts.withTags, certificate: opts.certificate });
  let body: string;
  try {
    body = renderTemplate(def.src, values, { logo: logoSvg }, doc);
  } catch (err) {
    if (err instanceof MissingFieldsError) throw new DocumentFieldsError([...new Set(err.missing.map(baseField))]);
    throw err;
  }
  const watermark = opts.watermark ?? !config.templatesApproved();
  const title = `${reference} - ${def.title}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>${fontFaceCss()}
${sharedCss}</style></head><body class="${doc === "certificate" ? "cert" : def.footer === "letter" ? "doc letter" : "doc"}">
${watermark ? `<div class="watermark">${escapeHtml(WATERMARK_TEXT)}</div>` : ""}
${body}
</body></html>`;
  const company = String(values.company_name);
  const left = def.footer === "sterling" ? STERLING_LINE : def.footer === "letter" ? company : `${company} · Ref: ${reference}`;
  const right = def.footer === "sterling" ? `Ref: ${reference} · ` : "";
  const footerHtml = footerTemplate(left, right, def.footer === "letter");
  return { doc, html, footerHtml, version: templateVersion(def.src), title, border: def.footer !== "letter", author: def.footer === "letter" ? company : "Sterling Pension Group LLC" };
}

function footerTemplate(left: string, rightPrefix: string, neutral = false) {
  // Chromium renders this in the bottom page margin; classes pageNumber/totalPages are filled in.
  return `<style>${fontFaceCss(["400"])}
  .f{box-sizing:border-box;width:100%;padding:0 1in 0.62in;font-family:Inter,sans-serif;font-size:7.5pt;color:${neutral ? "#666666" : "#5B6776"};-webkit-print-color-adjust:exact}
  .f .row{display:flex;justify-content:space-between;gap:12px;border-top:0.75pt solid ${neutral ? "#DDDDDD" : "#DCE3EC"};padding-top:7px}
  .f .l{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .f .r{white-space:nowrap}</style>
  <div class="f"><div class="row"><span class="l">${escapeHtml(left)}</span><span class="r">${escapeHtml(rightPrefix)}Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div></div>`;
}

export type RenderedDoc = { doc: DocKey; certNo?: number; name: string; pdf: Uint8Array; pages: number; version: string };
export type RenderItem = DocKey | { doc: DocKey; withTags?: boolean; certNo?: number; certificate?: CertificateValues };

/**
 * Render several documents to PDF in one Chromium session. `reference` is the case reference;
 * certificates print their own issue reference ({case}-C{n}).
 */
export async function renderDocuments(
  items: RenderItem[],
  fields: Fields,
  reference: string,
  opts: { watermark?: boolean } = {},
): Promise<RenderedDoc[]> {
  // Validate every document first so one call reports all missing fields.
  const missing = new Set<string>();
  const built: (BuiltDoc & { certNo?: number })[] = [];
  for (const raw of items) {
    const item = typeof raw === "string" ? { doc: raw } : raw;
    const ref = item.doc === "certificate" && item.certNo ? certRef(reference, item.certNo) : reference;
    try {
      built.push({ ...buildDocument(item.doc, fields, ref, { ...opts, withTags: item.withTags, certificate: item.certificate }), certNo: item.certNo });
    } catch (err) {
      if (err instanceof DocumentFieldsError) err.missing.forEach((m) => missing.add(m));
      else throw err;
    }
  }
  if (missing.size) throw new DocumentFieldsError([...missing]);
  const { htmlToPdfBatch } = await import("./pdf");
  const pdfs = await htmlToPdfBatch(built.map((b) => ({ html: b.html, footerHtml: b.footerHtml, title: b.title, border: b.border, author: b.author })));
  return built.map((b, i) => ({
    doc: b.doc,
    certNo: b.certNo,
    name: docFileName(reference, b.doc, b.certNo),
    pdf: pdfs[i].pdf,
    pages: pdfs[i].pages,
    version: b.version,
  }));
}
