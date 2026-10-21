// Private Vercel Blob store for cases and files. Every JSON read/modify/write is
// ETag-guarded (ifMatch) and retried on conflict, because webhooks and the admin can race.
import { BlobPreconditionFailedError, del, get, list, put } from "@vercel/blob";
import { config } from "./config";

const p = (path: string) => `${config.blobPrefix()}${path}`;

async function streamToBytes(stream: ReadableStream<Uint8Array>) {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readJson<T>(path: string): Promise<{ data: T; etag: string } | null> {
  // Uncompressed body: compressed responses carry a weak ETag (W/"…") that ifMatch rejects.
  const res = await get(p(path), { access: "private", useCache: false, headers: { "accept-encoding": "identity" } });
  if (!res || res.statusCode !== 200) return null;
  const text = new TextDecoder().decode(await streamToBytes(res.stream));
  return { data: JSON.parse(text) as T, etag: res.blob.etag.replace(/^W\//, "") };
}

/** Write JSON. With `etag`, only if unchanged; with `create`, only if absent. */
export async function writeJson(path: string, data: unknown, opts: { etag?: string; create?: boolean } = {}) {
  return put(p(path), JSON.stringify(data, null, 1), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
    ...(opts.etag ? { ifMatch: opts.etag } : opts.create ? {} : { allowOverwrite: true }),
  });
}

function isConflict(err: unknown) {
  if (err instanceof BlobPreconditionFailedError) return true;
  const msg = String((err as Error)?.message ?? "");
  return /already exists|precondition|conflicting operation|conditional request/i.test(msg);
}

export class ConflictError extends Error {}

/**
 * Read-modify-write with optimistic concurrency. `fn` gets the current value (or `init()` when
 * absent) and returns the new value. Retries with backoff on conflict.
 */
export async function updateJson<T>(path: string, fn: (current: T) => T | Promise<T>, init?: () => T): Promise<T> {
  const ATTEMPTS = 7;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const current = await readJson<T>(path);
    if (!current && !init) throw new Error(`Not found: ${path}`);
    const next = await fn(current ? current.data : init!());
    try {
      await writeJson(path, next, current ? { etag: current.etag } : { create: true });
      return next;
    } catch (err) {
      if (!isConflict(err) || attempt === ATTEMPTS - 1) throw isConflict(err) ? new ConflictError(`Conflict writing ${path}`) : err;
      await new Promise((r) => setTimeout(r, (60 << attempt) * (0.5 + Math.random())));
    }
  }
  throw new ConflictError(`Conflict writing ${path}`);
}

export async function putFile(path: string, body: Uint8Array | ArrayBuffer | Blob | string, contentType: string) {
  return put(p(path), body as Blob, { access: "private", contentType, addRandomSuffix: false, allowOverwrite: true });
}

export async function getFile(path: string) {
  const res = await get(p(path), { access: "private", useCache: false });
  if (!res || res.statusCode !== 200) return null;
  return res;
}

export async function getFileBytes(path: string) {
  const res = await getFile(path);
  if (!res) return null;
  return streamToBytes(res.stream);
}

export async function deleteFile(path: string) {
  await del(p(path));
}

/** Delete everything under a prefix (case data deletion). */
export async function deletePrefix(prefix: string) {
  let cursor: string | undefined;
  let count = 0;
  do {
    const page = await list({ prefix: p(prefix), cursor, limit: 1000 });
    if (page.blobs.length) {
      await del(page.blobs.map((b) => b.url));
      count += page.blobs.length;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return count;
}

export async function listPaths(prefix: string) {
  const out: { pathname: string; size: number; uploadedAt: Date }[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: p(prefix), cursor, limit: 1000 });
    for (const b of page.blobs) out.push({ pathname: b.pathname.slice(config.blobPrefix().length), size: b.size, uploadedAt: b.uploadedAt });
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}
