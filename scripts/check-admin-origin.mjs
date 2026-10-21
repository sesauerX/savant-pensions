// Production check for the /admin Origin rules. No secrets needed; sends no email
// (the login test uses an address that is not an admin).
//
//   node scripts/check-admin-origin.mjs [base-url]     (default https://sterlingpensiongroup.com)

const base = (process.argv[2] ?? "https://sterlingpensiongroup.com").replace(/\/$/, "");
const form = { "Content-Type": "application/x-www-form-urlencoded" };
const body = "email=origin-check%40example.com";

const cases = [
  {
    name: "login POST from our site (browser-style form) succeeds",
    req: { method: "POST", headers: { ...form, Origin: base }, body },
    ok: (r) => r.status === 303 && (r.headers.get("location") ?? "").endsWith("/admin/login/verify"),
  },
  {
    name: "login POST without Origin but with our Referer succeeds",
    req: { method: "POST", headers: { ...form, Referer: `${base}/admin/login` }, body },
    ok: (r) => r.status === 303,
  },
  {
    name: "login POST from a foreign Origin is 403",
    req: { method: "POST", headers: { ...form, Origin: "https://evil.example" }, body },
    ok: (r) => r.status === 403,
  },
  {
    name: 'login POST with "Origin: null" is 403',
    req: { method: "POST", headers: { ...form, Origin: "null" }, body },
    ok: (r) => r.status === 403,
  },
  {
    name: "login POST with no Origin and no Referer is 403",
    req: { method: "POST", headers: form, body },
    ok: (r) => r.status === 403,
  },
  {
    name: "case action from a foreign Origin is 403",
    path: "/admin/cases/SPG-2026-0001/action",
    req: { method: "POST", headers: { ...form, Origin: "https://evil.example" }, body: "_action=close" },
    ok: (r) => r.status === 403,
  },
  {
    name: "case action from our site without a session is 401",
    path: "/admin/cases/SPG-2026-0001/action",
    req: { method: "POST", headers: { ...form, Origin: base }, body: "_action=close" },
    ok: (r) => r.status === 401,
  },
  {
    name: "Resend webhook is exempt from the Origin check (unsigned → 401, not 403)",
    path: "/api/cases/inbound",
    req: { method: "POST", headers: { ...form, Origin: "https://evil.example" }, body: "{}" },
    ok: (r) => r.status === 401,
  },
  {
    name: "BoldSign webhook is exempt from the Origin check (unsigned → 401/503, not 403)",
    path: "/api/cases/boldsign",
    req: { method: "POST", headers: { ...form, "X-BoldSign-Event": "Completed" }, body: "{}" },
    ok: (r) => r.status === 401 || r.status === 503,
  },
];

let failed = 0;
for (const c of cases) {
  const res = await fetch(base + (c.path ?? "/admin/login"), { ...c.req, redirect: "manual" });
  const pass = c.ok(res);
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${res.status}  ${c.name}`);
}
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
