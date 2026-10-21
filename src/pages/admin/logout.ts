import type { APIRoute } from "astro";
import { csrfOk, endSession, logAuthEvent } from "../../lib/cases/auth";
import { redirect } from "../../lib/cases/http";

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const form = await request.formData();
  const session = locals.session;
  if (session && csrfOk(session, form.get("_csrf"))) {
    endSession(cookies);
    await logAuthEvent(`signed out: ${session.name}`);
  }
  return redirect("/admin/login");
};
