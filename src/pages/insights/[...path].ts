import type { APIRoute } from "astro";

export const prerender = false;

// The blog moved from /insights to /the-brief. Every old URL, with or without a
// trailing slash, gets a permanent redirect:
//   /insights, /insights/archive -> /the-brief
//   /insights/<slug>             -> /the-brief/<slug>
// One route handles them all; Astro's config redirects only match exact paths,
// and inside the Vercel function they shadow this route for slash variants.
export const GET: APIRoute = ({ params }) => {
  const parts = (params.path ?? "").split("/").filter(Boolean);
  let target: string | null = null;
  if (parts.length === 0 || (parts.length === 1 && parts[0] === "archive")) target = "/the-brief";
  else if (parts.length === 1) target = `/the-brief/${parts[0]}`;
  if (!target) return new Response("Not found", { status: 404 });
  return new Response(null, {
    status: 301,
    headers: { Location: target, "Cache-Control": "public, max-age=3600, s-maxage=31536000" },
  });
};

export const HEAD = GET;
