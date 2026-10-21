// Guards for the case admin (/admin/**) and case endpoints (/api/cases/**).
// Everything else on the site passes through untouched.
import { defineMiddleware } from "astro:middleware";
import { config } from "./lib/cases/config";
import { getSession } from "./lib/cases/auth";
import { applyAdminHeaders, notFound, redirect, requestFromOurSite } from "./lib/cases/http";

const PUBLIC_ADMIN = new Set(["/admin/login", "/admin/login/verify"]);

export const onRequest = defineMiddleware(async (ctx, next) => {
  const path = ctx.url.pathname.replace(/\/+$/, "") || "/";
  const isAdmin = path === "/admin" || path.startsWith("/admin/");
  const isCasesApi = path.startsWith("/api/cases/");
  if (!isAdmin && !isCasesApi) return next();
  if (ctx.isPrerendered) return next();
  if (!config.enabled() && !import.meta.env.DEV) return notFound();
  if (!isAdmin) return next(); // webhook/cron/file endpoints authenticate themselves

  // Origin allowlist for every state-changing admin request, including the login forms that have
  // no session yet. Signed-in actions also need a CSRF token. Webhooks returned above.
  if (ctx.request.method !== "GET" && ctx.request.method !== "HEAD") {
    if (!requestFromOurSite(ctx.request)) {
      return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
    }
  }

  const session = await getSession(ctx.cookies);
  ctx.locals.session = session;
  if (!session && !PUBLIC_ADMIN.has(path)) {
    if (ctx.request.method === "GET") return redirect("/admin/login", 302);
    return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const res = await next();
  // Responses from endpoints may have immutable headers; copy when needed.
  try {
    applyAdminHeaders(res.headers);
    return res;
  } catch {
    const copy = new Response(res.body, res);
    applyAdminHeaders(copy.headers);
    return copy;
  }
});
