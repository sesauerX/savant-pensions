// Issues a short-lived client token so the browser can upload a file (up to 25 MB) straight
// to the private Blob store; the server function body limit is too small for scans.
import type { APIRoute } from "astro";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { csrfOk } from "../../../../lib/cases/auth";
import { isCaseId, randomId } from "../../../../lib/cases/cases";
import { config } from "../../../../lib/cases/config";
import { MAX_UPLOAD, UPLOAD_TYPES } from "../../../../lib/cases/actions";

export const prerender = false;

export const POST: APIRoute = async ({ params, request, locals }) => {
  const session = locals.session;
  const id = String(params.id ?? "");
  if (!session || !isCaseId(id)) return new Response("Not found", { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { csrf?: string; name?: string; type?: string; size?: number };
  if (!csrfOk(session, body.csrf)) return Response.json({ error: "Session expired; reload the page." }, { status: 403 });
  const type = String(body.type ?? "");
  const size = Number(body.size ?? 0);
  if (!UPLOAD_TYPES[type]) return Response.json({ error: "Only PDF, JPEG and PNG files are accepted." }, { status: 400 });
  if (!(size > 0 && size <= MAX_UPLOAD)) return Response.json({ error: "Files can be at most 25 MB." }, { status: 400 });
  const base = String(body.name ?? "upload")
    .replace(/\.[a-z0-9]+$/i, "")
    .normalize("NFKD")
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60) || "upload";
  const path = `cases/${id}/uploads/${randomId()}-${base}.${UPLOAD_TYPES[type]}`;
  const pathname = `${config.blobPrefix()}${path}`;
  const token = await generateClientTokenFromReadWriteToken({
    token: process.env.BLOB_READ_WRITE_TOKEN,
    pathname,
    allowedContentTypes: [type],
    maximumSizeInBytes: MAX_UPLOAD,
    validUntil: Date.now() + 10 * 60 * 1000,
    addRandomSuffix: false,
    allowOverwrite: false,
  });
  return Response.json({ token, pathname, path });
};
