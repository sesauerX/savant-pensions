// Local dev only: checks ETag-guarded concurrent updates against the real Blob store (dev/ prefix).
import type { APIRoute } from "astro";
import { updateJson, writeJson, readJson } from "../../../lib/cases/store";

export const prerender = false;

export const GET: APIRoute = async () => {
  if (!import.meta.env.DEV) return new Response("Not found", { status: 404 });
  const path = "test/concurrency.json";
  await writeJson(path, { n: 0, by: [] });
  const workers = 6;
  const results = await Promise.allSettled(
    Array.from({ length: workers }, (_, i) =>
      updateJson<{ n: number; by: number[] }>(path, (c) => ({ n: c.n + 1, by: [...c.by, i] })),
    ),
  );
  const final = (await readJson<{ n: number; by: number[] }>(path))?.data;
  const failed = results.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason));
  // Every successful update must be counted exactly once: no lost writes.
  const ok = final?.n === workers - failed.length && new Set(final?.by).size === final?.n;
  return Response.json({ ok, workers, succeeded: workers - failed.length, final, failed });
};
