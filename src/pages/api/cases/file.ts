// Streams a stored case or inbox file. Admin session required; files never have public URLs.
import type { APIRoute } from "astro";
import { getSession } from "../../../lib/cases/auth";
import { fileById, getCase, isCaseId } from "../../../lib/cases/cases";
import { config } from "../../../lib/cases/config";
import { listInbox } from "../../../lib/cases/inbound";
import { getFile } from "../../../lib/cases/store";
import { notFound } from "../../../lib/cases/http";

export const prerender = false;

const INLINE = new Set(["application/pdf", "image/jpeg", "image/png"]);

export const GET: APIRoute = async ({ url, cookies }) => {
  if (!config.enabled() && !import.meta.env.DEV) return notFound();
  const session = await getSession(cookies);
  if (!session) return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });

  let path: string | undefined;
  let name = "file";
  let type = "application/octet-stream";
  const caseId = url.searchParams.get("case") ?? "";
  const fileId = url.searchParams.get("file") ?? "";
  const inboxId = url.searchParams.get("inbox") ?? "";
  if (caseId) {
    if (!isCaseId(caseId)) return notFound();
    const c = await getCase(caseId);
    const f = c && fileById(c, fileId);
    if (!f) return notFound();
    ({ path, name } = f);
    type = f.contentType;
  } else if (inboxId) {
    const item = (await listInbox()).find((i) => i.emailId === inboxId);
    const f = item?.files.find((x) => x.id === fileId);
    if (!f) return notFound();
    ({ path, name } = f);
    type = f.contentType;
  } else return notFound();

  const res = await getFile(path!);
  if (!res) return notFound();
  const download = url.searchParams.get("download") === "1" || !INLINE.has(type);
  const ascii = name.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "'");
  return new Response(res.stream, {
    headers: {
      "Content-Type": INLINE.has(type) ? type : "application/octet-stream",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });
};
