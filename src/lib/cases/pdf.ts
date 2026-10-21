// HTML to PDF with headless Chromium (serverless: @sparticuz/chromium), then
// pdf-lib draws the navy page border and gold hairline on every page.
import { PDFDocument, rgb } from "pdf-lib";
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

/** Border, hairline and metadata on every page. */
export async function finishPdf(bytes: Uint8Array, title: string, border = true, author = "Sterling Pension Group LLC") {
  const pdf = await PDFDocument.load(bytes);
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
  return { pdf: await pdf.save(), pages: pdf.getPageCount() };
}

export async function htmlToPdfBatch(items: { html: string; footerHtml: string; title: string; border?: boolean; author?: string }[]) {
  const started = Date.now();
  const browser = await launch();
  try {
    const out: { pdf: Uint8Array; pages: number }[] = [];
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
