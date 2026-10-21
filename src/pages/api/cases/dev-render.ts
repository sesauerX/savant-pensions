// Renders the five documents from the fictional fixture, for template checks.
// Local dev: open freely. Production: requires `Authorization: Bearer CRON_SECRET` or an admin session.
import type { APIRoute } from "astro";
import { DOC_KEYS, buildDocument, renderDocuments, type DocKey } from "../../../lib/cases/documents";
import { FIXTURE_REFERENCE, fixtureFields } from "../../../lib/cases/fixture";
import { config } from "../../../lib/cases/config";
import { bearerOk, notFound } from "../../../lib/cases/http";
import { getSession } from "../../../lib/cases/auth";

export const prerender = false;

export const GET: APIRoute = async ({ request, url, cookies }) => {
  if (!config.enabled() && !import.meta.env.DEV) return notFound();
  if (!import.meta.env.DEV && !bearerOk(request, config.cronSecret()) && !(await getSession(cookies))) return notFound();

  const doc = (url.searchParams.get("doc") ?? "certificate") as DocKey;
  if (!DOC_KEYS.includes(doc)) return new Response("unknown doc", { status: 400 });
  const fields = fixtureFields({
    survivor: url.searchParams.get("survivor") === "1",
    existing: url.searchParams.get("existing") === "1",
    cents: url.searchParams.get("cents") === "1",
  });
  const watermark = url.searchParams.get("watermark") !== "0";

  if (url.searchParams.get("format") === "html") {
    const built = buildDocument(doc, fields, FIXTURE_REFERENCE, { watermark });
    return new Response(built.html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
  const started = Date.now();
  const [out] = await renderDocuments([doc], fields, FIXTURE_REFERENCE, { watermark });
  return new Response(out.pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${out.name}"`,
      "X-Pages": String(out.pages),
      "X-Template-Version": out.version,
      "X-Render-Ms": String(Date.now() - started),
      "Cache-Control": "no-store",
    },
  });
};
