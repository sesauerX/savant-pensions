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
  // same-origin, not no-referrer: with no-referrer browsers send "Origin: null" on form POSTs.
  "Referrer-Policy": "same-origin",
  "X-Robots-Tag": "noindex, nofollow",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  // Inline styles/scripts are Astro's own; no third-party origins. Frames only for same-origin PDF preview
  // and sandboxed srcdoc email bodies.
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self' https://vercel.com https://*.vercel-storage.com; frame-src 'self'; object-src 'self'; frame-ancestors 'self'; form-action 'self'; base-uri 'none'",
};

export function applyAdminHeaders(headers: Headers) {
  for (const [k, v] of Object.entries(ADMIN_HEADERS)) headers.set(k, v);
}

const SITE_ORIGINS = ["https://sterlingpensiongroup.com", "https://www.sterlingpensiongroup.com"];

function originOf(value: string | null) {
  if (!value || value === "null") return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** Origins allowed to POST to /admin. Never derived from request.url (wrong behind the proxy). */
export function originAllowed(origin: string) {
  if (SITE_ORIGINS.includes(origin)) return true;
  const extra = originOf(process.env.CASES_SITE_URL ?? null);
  if (extra && origin === extra) return true;
  if (import.meta.env.DEV) return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return false;
}

/** Same-site check for state-changing admin requests: Origin, or Referer when Origin is absent. */
export function requestFromOurSite(request: Request) {
  const origin = originOf(request.headers.get("origin")) ?? originOf(request.headers.get("referer"));
  return origin !== null && originAllowed(origin);
}

export function redirect(location: string, status = 303) {
  return new Response(null, { status, headers: { Location: location, "Cache-Control": "no-store" } });
}

export function clientIp(request: Request) {
  return (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
}

/** One-shot flash message carried in a short-lived cookie (keeps messages out of URLs). */
export type Flash = { ok: boolean; message: string };
type Cookies = { get(name: string): { value: string } | undefined; set(name: string, value: string, opts: object): void; delete(name: string, opts: object): void };
export function setFlash(cookies: Cookies, flash: Flash) {
  cookies.set("spg_flash", Buffer.from(JSON.stringify(flash)).toString("base64url"), { path: "/admin", httpOnly: true, sameSite: "strict", secure: !import.meta.env.DEV, maxAge: 60 });
}
export function takeFlash(cookies: Cookies): Flash | null {
  const v = cookies.get("spg_flash")?.value;
  if (!v) return null;
  cookies.delete("spg_flash", { path: "/admin" });
  try {
    const f = JSON.parse(Buffer.from(v, "base64url").toString());
    return { ok: Boolean(f.ok), message: String(f.message ?? "").slice(0, 600) };
  } catch {
    return null;
  }
}
