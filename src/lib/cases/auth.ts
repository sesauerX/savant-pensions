// Admin sign-in by emailed one-time code; HMAC-signed session cookie; CSRF tokens.
import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import type { AstroCookies } from "astro";
import { config, type AdminUser } from "./config";
import { readJson, updateJson, writeJson, deleteFile } from "./store";
import { safeEqual } from "./http";

const SESSION_COOKIE = "spg_admin";
const LOGIN_COOKIE = "spg_login";
const SESSION_MS = 12 * 60 * 60 * 1000;
const OTP_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_PER_EMAIL = 3;
const RATE_PER_IP = 10;

export type Session = { email: string; name: string; role: AdminUser["role"]; nonce: string; exp: number };

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function secret() {
  const s = config.sessionSecret();
  if (s.length < 32) throw new Error("SESSION_SECRET is not configured");
  return s;
}
const hmac = (data: string) => createHmac("sha256", secret()).update(data).digest("base64url");

function sign(payload: object) {
  const body = b64u(JSON.stringify(payload));
  return `${body}.${hmac(body)}`;
}
function verify<T>(token: string | undefined): T | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac || !safeEqual(mac, hmac(body))) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString()) as T;
  } catch {
    return null;
  }
}

export function findUser(email: string) {
  const e = email.trim().toLowerCase();
  return config.adminUsers().find((u) => u.email === e) ?? null;
}

const cookieOpts = (maxAgeSec: number) => ({
  path: "/",
  httpOnly: true,
  secure: !import.meta.env.DEV,
  sameSite: "strict" as const,
  maxAge: maxAgeSec,
});

export async function getSession(cookies: AstroCookies): Promise<Session | null> {
  if (config.sessionSecret().length < 32) return null;
  const s = verify<{ e: string; x: number; n: string }>(cookies.get(SESSION_COOKIE)?.value);
  if (!s || s.x < Date.now()) return null;
  const user = findUser(s.e); // removed users lose access immediately
  if (!user) return null;
  return { email: user.email, name: user.name, role: user.role, nonce: s.n, exp: s.x };
}

export function startSession(cookies: AstroCookies, user: AdminUser) {
  const token = sign({ e: user.email, x: Date.now() + SESSION_MS, n: b64u(randomBytes(12)) });
  cookies.set(SESSION_COOKIE, token, cookieOpts(SESSION_MS / 1000));
}

export function endSession(cookies: AstroCookies) {
  cookies.delete(SESSION_COOKIE, { path: "/" });
}

export function csrfToken(session: Session) {
  return hmac(`csrf:${session.nonce}:${session.email}`);
}

export function csrfOk(session: Session, token: unknown) {
  return typeof token === "string" && safeEqual(token, csrfToken(session));
}

// ---- Login cookie: remembers which email a code was requested for (keeps it out of the URL).
export function setLoginEmail(cookies: AstroCookies, email: string) {
  cookies.set(LOGIN_COOKIE, sign({ e: email.trim().toLowerCase(), x: Date.now() + OTP_MS }), cookieOpts(OTP_MS / 1000));
}
export function getLoginEmail(cookies: AstroCookies) {
  const s = verify<{ e: string; x: number }>(cookies.get(LOGIN_COOKIE)?.value);
  return s && s.x > Date.now() ? s.e : null;
}
export function clearLoginEmail(cookies: AstroCookies) {
  cookies.delete(LOGIN_COOKIE, { path: "/" });
}

// ---- One-time codes
type Otp = { mac: string; exp: number; attempts: number };
const otpPath = (email: string) => `auth/otp/${sha256(email.toLowerCase())}.json`;
const codeMac = (email: string, code: string) => hmac(`otp:${email.toLowerCase()}:${code}`);

/** Best-effort sliding-window rate limit. Returns false when over the limit. */
async function rateOk(key: string, limit: number) {
  const path = `auth/rate/${sha256(key)}.json`;
  const now = Date.now();
  let allowed = true;
  try {
    await updateJson<number[]>(
      path,
      (hits) => {
        const recent = hits.filter((t) => now - t < RATE_WINDOW_MS);
        if (recent.length >= limit) {
          allowed = false;
          return recent;
        }
        return [...recent, now];
      },
      () => [],
    );
  } catch {
    // Storage hiccup: fail open for rate limiting only (the code itself is still required).
  }
  return allowed;
}

export type CodeRequestResult = "sent" | "unknown" | "limited" | "error";

/**
 * Create and email a code if the address is an admin. Callers show the same message
 * whatever the result, so nobody learns who has access.
 */
export async function requestCode(email: string, ip: string, send: (to: string, code: string) => Promise<boolean>): Promise<CodeRequestResult> {
  const e = email.trim().toLowerCase();
  if (!(await rateOk(`ip:${ip}`, RATE_PER_IP))) return "limited";
  const user = findUser(e);
  if (!user) return "unknown";
  if (!(await rateOk(`email:${e}`, RATE_PER_EMAIL))) return "limited";
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await writeJson(otpPath(e), { mac: codeMac(e, code), exp: Date.now() + OTP_MS, attempts: 0 } satisfies Otp);
  const ok = await send(user.email, code);
  return ok ? "sent" : "error";
}

export type VerifyResult = { ok: true; user: AdminUser } | { ok: false; reason: "invalid" | "expired" | "locked" };

export async function verifyCode(email: string, code: string): Promise<VerifyResult> {
  const e = email.trim().toLowerCase();
  const user = findUser(e);
  const path = otpPath(e);
  const current = await readJson<Otp>(path);
  if (!user || !current) return { ok: false, reason: "invalid" };
  const otp = current.data;
  if (otp.exp < Date.now()) {
    await deleteFile(path).catch(() => {});
    return { ok: false, reason: "expired" };
  }
  if (otp.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: "locked" };
  const clean = code.replace(/\D/g, "");
  if (clean.length === 6 && safeEqual(otp.mac, codeMac(e, clean))) {
    // Consume: delete so the code cannot be reused.
    await deleteFile(path);
    return { ok: true, user };
  }
  const attempts = otp.attempts + 1;
  try {
    await writeJson(path, { ...otp, attempts }, { etag: current.etag });
  } catch {
    // A concurrent attempt changed it; count conservatively by locking.
    await writeJson(path, { ...otp, attempts: OTP_MAX_ATTEMPTS }).catch(() => {});
  }
  return { ok: false, reason: attempts >= OTP_MAX_ATTEMPTS ? "locked" : "invalid" };
}

// ---- Auth event log (monthly file; no codes or secrets)
export async function logAuthEvent(text: string) {
  const month = new Date().toISOString().slice(0, 7);
  try {
    await updateJson<{ at: string; text: string }[]>(
      `auth/log-${month}.json`,
      (log) => [...log, { at: new Date().toISOString(), text }].slice(-5000),
      () => [],
    );
  } catch (err) {
    console.error("[cases] auth log write failed", (err as Error).name);
  }
}
