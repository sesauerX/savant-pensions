// HTML to PDF with headless Chromium (serverless: @sparticuz/chromium), then
// pdf-lib draws the navy page border and gold hairline on every page.
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString, rgb } from "pdf-lib";
import { config } from "./config";

const LOCAL_CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

async function launch() {
  const puppeteer = (await import("puppeteer-core")).default;
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return puppeteer.launch({
      args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
      executablePath: await chromium.executablePath(),
      headless: "shell",
    });
  }
  const { existsSync } = await import("node:fs");
  const executablePath = config.chromePath() || LOCAL_CHROME.find((p) => existsSync(p));
  if (!executablePath) throw new Error("No local Chrome found; set CHROME_PATH");
  return puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", "--font-render-hinting=none"] });
}

const NAVY = rgb(11 / 255, 37 / 255, 69 / 255);
const GOLD = rgb(242 / 255, 179 / 255, 61 / 255);
const PT = 72; // points per inch

/** A signature field marker found in the PDF (PDF points, origin bottom-left; page is 0-based). */
export type FieldMarker = { id: string; page: number; x: number; y: number; width: number; height: number; pageWidth: number; pageHeight: number };

const MARKER = "https://sig.invalid/";

/** Read and remove the signature marker links (see .sigbox in shared.css). */
function takeMarkers(pdf: PDFDocument): FieldMarker[] {
  const found: FieldMarker[] = [];
  pdf.getPages().forEach((page, index) => {
    const annots = page.node.Annots();
    if (!annots) return;
    const keep = [];
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i);
      const dict = pdf.context.lookup(ref);
      let uri = "";
      if (dict instanceof PDFDict) {
        const action = dict.lookup(PDFName.of("A"));
        const value = action instanceof PDFDict ? action.lookup(PDFName.of("URI")) : undefined;
        if (value instanceof PDFString || value instanceof PDFHexString) uri = value.decodeText();
      }
      if (dict instanceof PDFDict && uri.startsWith(MARKER)) {
        const rect = dict.lookup(PDFName.of("Rect"));
        const n = rect instanceof PDFArray ? rect.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : 0)) : [0, 0, 0, 0];
        const { width, height } = page.getSize();
        found.push({ id: uri.slice(MARKER.length), page: index, x: Math.min(n[0], n[2]), y: Math.min(n[1], n[3]), width: Math.abs(n[2] - n[0]), height: Math.abs(n[3] - n[1]), pageWidth: width, pageHeight: height });
      } else keep.push(ref);
    }
    if (keep.length) page.node.set(PDFName.of("Annots"), pdf.context.obj(keep));
    else page.node.delete(PDFName.of("Annots"));
  });
  return found;
}

/** Border, hairline and metadata on every page; signature markers are read and removed. */
export async function finishPdf(bytes: Uint8Array, title: string, border = true, author = "Sterling Pension Group LLC") {
  const pdf = await PDFDocument.load(bytes);
  const fields = takeMarkers(pdf);
  for (const page of border ? pdf.getPages() : []) {
    const { width, height } = page.getSize();
    const outer = 0.36 * PT;
    const inner = 0.45 * PT;
    page.drawRectangle({ x: outer, y: outer, width: width - 2 * outer, height: height - 2 * outer, borderColor: NAVY, borderWidth: 1.6 });
    page.drawRectangle({ x: inner, y: inner, width: width - 2 * inner, height: height - 2 * inner, borderColor: GOLD, borderWidth: 0.75 });
  }
  pdf.setTitle(title);
  pdf.setAuthor(author);
  pdf.setCreator(author);
  pdf.setProducer(author);
  return { pdf: await pdf.save(), pages: pdf.getPageCount(), fields };
}

export async function htmlToPdfBatch(items: { html: string; footerHtml: string; title: string; border?: boolean; author?: string }[]) {
  const started = Date.now();
  const browser = await launch();
  try {
    const out: { pdf: Uint8Array; pages: number; fields: FieldMarker[] }[] = [];
    for (const item of items) {
      const page = await browser.newPage();
      try {
        await page.setJavaScriptEnabled(false);
        await page.setContent(item.html, { waitUntil: "load" });
        await page.evaluateHandle("document.fonts.ready");
        const raw = await page.pdf({
          format: "letter",
          printBackground: true,
          preferCSSPageSize: true,
          displayHeaderFooter: true,
          headerTemplate: "<span></span>",
          footerTemplate: item.footerHtml,
        });
        out.push(await finishPdf(raw, item.title, item.border ?? true, item.author));
      } finally {
        await page.close();
      }
    }
    console.log(`[cases] rendered ${items.length} PDF(s) in ${Date.now() - started} ms`);
    return out;
  } finally {
    await browser.close();
  }
}
