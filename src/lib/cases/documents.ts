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
import { templateValues } from "./derive";
import type { Fields } from "./schema";
import { config } from "./config";

export type DocKey = "operating_agreement" | "pension_policy" | "written_consent" | "award_letter" | "certificate";

export const DOC_KEYS: DocKey[] = ["operating_agreement", "pension_policy", "written_consent", "award_letter", "certificate"];
/** Documents signed through BoldSign, in envelope order. */
export const BOLDSIGN_DOCS: DocKey[] = ["operating_agreement", "pension_policy", "written_consent"];
/** Documents generated at confirm time (the certificate waits for the first payment). */
export const INITIAL_DOCS: DocKey[] = ["operating_agreement", "pension_policy", "written_consent", "award_letter"];

type DocDef = { n: number; title: string; short: string; src: string; footer: "sterling" | "company" };

export const DOCS: Record<DocKey, DocDef> = {
  operating_agreement: { n: 1, title: "Operating Agreement", short: "Operating Agreement", src: oaSrc, footer: "company" },
  pension_policy: { n: 2, title: "Corporate Pension Policy", short: "Pension Policy", src: policySrc, footer: "company" },
  written_consent: { n: 3, title: "Written Consent of Sole Member", short: "Written Consent", src: consentSrc, footer: "company" },
  award_letter: { n: 4, title: "Pension Award Letter", short: "Award Letter", src: awardSrc, footer: "company" },
  certificate: { n: 5, title: "Certificate of Pension Administration", short: "Certificate", src: certSrc, footer: "sterling" },
};

export const WATERMARK_TEXT = "DRAFT – PENDING COUNSEL REVIEW";
const STERLING_LINE = "Sterling Pension Group LLC · 15 N Main St #100, West Hartford, CT 06107, USA";

export function docFileName(reference: string, doc: DocKey) {
  return `${reference} - ${DOCS[doc].n} ${DOCS[doc].title}.pdf`;
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

export type BuiltDoc = { doc: DocKey; html: string; footerHtml: string; version: string; title: string };

/** Fill a template and wrap it in a full HTML page. Throws DocumentFieldsError with every missing field. */
export function buildDocument(
  doc: DocKey,
  fields: Fields,
  reference: string,
  opts: { watermark?: boolean } = {},
): BuiltDoc {
  const def = DOCS[doc];
  const values = templateValues(fields, reference, { showPassport: config.showPassport() });
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
${sharedCss}</style></head><body class="${doc === "certificate" ? "cert" : "doc"}">
${watermark ? `<div class="watermark">${escapeHtml(WATERMARK_TEXT)}</div>` : ""}
${body}
</body></html>`;
  const left = def.footer === "sterling" ? STERLING_LINE : `${String(values.company_name)} · Ref: ${reference}`;
  const right = def.footer === "sterling" ? `Ref: ${reference} · ` : "";
  const footerHtml = footerTemplate(left, right);
  return { doc, html, footerHtml, version: templateVersion(def.src), title };
}

function footerTemplate(left: string, rightPrefix: string) {
  // Chromium renders this in the bottom page margin; classes pageNumber/totalPages are filled in.
  return `<style>${fontFaceCss(["400"])}
  .f{box-sizing:border-box;width:100%;padding:0 1in 0.62in;font-family:Inter,sans-serif;font-size:7.5pt;color:#5B6776;-webkit-print-color-adjust:exact}
  .f .row{display:flex;justify-content:space-between;gap:12px;border-top:0.75pt solid #DCE3EC;padding-top:7px}
  .f .r{white-space:nowrap}</style>
  <div class="f"><div class="row"><span>${escapeHtml(left)}</span><span class="r">${escapeHtml(rightPrefix)}Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div></div>`;
}

export type RenderedDoc = { doc: DocKey; name: string; pdf: Uint8Array; pages: number; version: string };

/** Render several documents to PDF in one Chromium session. */
export async function renderDocuments(
  docs: DocKey[],
  fields: Fields,
  reference: string,
  opts: { watermark?: boolean } = {},
): Promise<RenderedDoc[]> {
  // Validate every document first so one call reports all missing fields.
  const missing = new Set<string>();
  const built: BuiltDoc[] = [];
  for (const doc of docs) {
    try {
      built.push(buildDocument(doc, fields, reference, opts));
    } catch (err) {
      if (err instanceof DocumentFieldsError) err.missing.forEach((m) => missing.add(m));
      else throw err;
    }
  }
  if (missing.size) throw new DocumentFieldsError([...missing]);
  const { htmlToPdfBatch } = await import("./pdf");
  const pdfs = await htmlToPdfBatch(built.map((b) => ({ html: b.html, footerHtml: b.footerHtml, title: b.title })));
  return built.map((b, i) => ({
    doc: b.doc,
    name: docFileName(reference, b.doc),
    pdf: pdfs[i].pdf,
    pages: pdfs[i].pages,
    version: b.version,
  }));
}
