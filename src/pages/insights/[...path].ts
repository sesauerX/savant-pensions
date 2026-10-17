import type { APIRoute } from "astro";

export const prerender = false;

// The redirects in astro.config.mjs only match /insights, /insights/archive and
// /insights/<slug> exactly. Vercel falls through to this route for the
// trailing-slash variants (/insights/, /insights/archive/, /insights/<slug>/),
// which get the same permanent redirects.
export const GET: APIRoute = ({ params }) => {
  const parts = (params.path ?? "").split("/").filter(Boolean);
  let target: string | null = null;
  if (parts.length === 0 || (parts.length === 1 && parts[0] === "archive")) target = "/the-brief";
  else if (parts.length === 1) target = `/the-brief/${parts[0]}`;
  if (!target) return new Response("Not found", { status: 404 });
  return new Response(null, { status: 301, headers: { Location: target } });
};

export const HEAD = GET;
