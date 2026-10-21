// Small HTTP helpers shared by the case endpoints and admin pages.
import { timingSafeEqual, createHash } from "node:crypto";

export function notFound() {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

/** Constant-time string compare (via SHA-256 so lengths never leak). */
export function safeEqual(a: string, b: string) {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

export function bearerOk(request: Request, secret: string) {
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  return safeEqual(header, `Bearer ${secret}`);
}

export const ADMIN_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  // Inline styles/scripts are Astro's own; no third-party origins. Frames only for same-origin PDF preview
  // and sandboxed srcdoc email bodies.
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-src 'self'; object-src 'self'; frame-ancestors 'self'; form-action 'self'; base-uri 'none'",
};

export function applyAdminHeaders(headers: Headers) {
  for (const [k, v] of Object.entries(ADMIN_HEADERS)) headers.set(k, v);
}

export function redirect(location: string, status = 303) {
  return new Response(null, { status, headers: { Location: location, "Cache-Control": "no-store" } });
}

export function clientIp(request: Request) {
  return (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
}
