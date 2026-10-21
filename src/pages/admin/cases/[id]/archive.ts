// Case archive download (ZIP). Admin session required (middleware); every download is logged.
import type { APIRoute } from "astro";
import { archiveEntries, summaryHtml } from "../../../../lib/cases/archive";
import { addEvent, isCaseId, mutateCase } from "../../../../lib/cases/cases";
import { htmlToPdfBatch } from "../../../../lib/cases/pdf";
import { escapeHtml } from "../../../../lib/cases/templates/render";
import { fontFaceCss } from "../../../../lib/cases/fonts";
import { zipStream } from "../../../../lib/cases/zip";

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
  const session = locals.session;
  const id = String(params.id ?? "");
  if (!session || !isCaseId(id)) return new Response("Not found", { status: 404 });
  let c;
  try {
    c = await mutateCase(id, session.name, (cc) => addEvent(cc, session.name, "Case archive (ZIP) downloaded"));
  } catch {
    return new Response("Not found", { status: 404 });
  }
  console.log(`[cases] archive ${id} downloaded by ${session.name}`);
  const footer = `<style>${fontFaceCss(["400"])}.f{box-sizing:border-box;width:100%;padding:0 0.7in 0.45in;font-family:Inter,sans-serif;font-size:7pt;color:#666;display:flex;justify-content:space-between}</style><div class="f"><span>${escapeHtml(id)} case summary · internal</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
  const [summary] = await htmlToPdfBatch([{ html: summaryHtml(c, session.name), footerHtml: footer, title: `${id} case summary`, border: false }]);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(zipStream(archiveEntries(c, summary.pdf)), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${id} case archive ${date}.zip"`,
      "Cache-Control": "no-store",
    },
  });
};
