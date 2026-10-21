// Local dev only: simulate a completed BoldSign envelope for a case (main envelope or one
// certificate) by assembling the "signed" PDF from the stored documents plus one audit page.
import type { APIRoute } from "astro";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { fileById } from "../../../lib/cases/cases";
import { getFileBytes } from "../../../lib/cases/store";
import { certByNo, completeCertificateSigning, completeSigning, loadCase } from "../../../lib/cases/workflow";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  if (!import.meta.env.DEV) return new Response("Not found", { status: 404 });
  const id = url.searchParams.get("case") ?? "";
  const certNo = Number(url.searchParams.get("cert")) || 0;
  const c = await loadCase(id);
  const ids = certNo
    ? [certByNo(c, certNo)?.files.current]
    : [...(["operating_agreement", "pension_policy", "written_consent", "award_letter"] as const).map((d) => c.docs[d].current), certByNo(c, 1)?.files.current];
  const out = await PDFDocument.create();
  for (const fid of ids) {
    const f = fileById(c, fid);
    const bytes = f && (await getFileBytes(f.path));
    if (!bytes) return new Response(`missing file ${fid}`, { status: 400 });
    const src = await PDFDocument.load(bytes);
    (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
  }
  const audit = out.addPage([612, 792]);
  audit.drawText("Simulated BoldSign audit trail (local test)", { x: 72, y: 700, size: 14, font: await out.embedFont(StandardFonts.Helvetica) });
  const combined = await out.save();
  const done = certNo ? await completeCertificateSigning(id, "local self-test", certNo, { combined }) : await completeSigning(id, "local self-test", { combined });
  return Response.json({ ok: true, pages: out.getPageCount(), milestones: Object.keys(done.milestones), certificates: done.certificates.map((x) => ({ no: x.no, signed: Boolean(x.files.signed) })) });
};
