import type { APIRoute } from "astro";
import { clean, configured, looksLikeSpam, sendAdminEmail, sourcePage } from "../../lib/notify";

export const prerender = false;

// Notification for each calculator run (the visitor pressing the button).
// The page never waits on this, so the visitor sees no change in behaviour.
export const POST: APIRoute = async ({ request }) => {
  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  if (looksLikeSpam(payload)) return Response.json({ ok: true });

  const num = (value: unknown, min: number, max: number) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  };
  const age = num(payload.age, 0, 120);
  const income = num(payload.income, 0, 1e9);
  const employees = num(payload.employees, 0, 1e6);
  const estimate = num(payload.estimate, 0, 1e9);
  if (age === null || income === null || employees === null || estimate === null) {
    return Response.json({ ok: false }, { status: 400 });
  }
  if (!configured()) return Response.json({ ok: false }, { status: 503 });

  const usd = (n: number) => "$" + n.toLocaleString("en-US");
  const sent = await sendAdminEmail({
    subject: "New calculator estimate – Sterling Pension Group",
    fields: [
      ["Owner age", String(age)],
      ["Estimated earned income", usd(income)],
      ["Employees (approx.)", String(employees)],
      ["Estimate shown", usd(estimate)],
      ["Result text", clean(payload.result, 300)],
    ],
    page: sourcePage(payload, request),
    note: "The calculator does not ask for contact details, so this is an anonymous estimate.",
  });
  return Response.json({ ok: sent }, { status: sent ? 200 : 502 });
};
