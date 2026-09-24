import type { APIRoute } from "astro";
import { posts } from "../lib/posts";
import { SITE, pages } from "../lib/seo";

export const GET: APIRoute = () => {
  const paths = [...Object.keys(pages), ...posts.map((post) => `/insights/${post.slug}`)];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths
  .map((path) => {
    const loc = `${SITE}${path === "/" ? "/" : path}`;
    return `  <url><loc>${loc}</loc></url>`;
  })
  .join("\n")}
</urlset>
`;
  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
