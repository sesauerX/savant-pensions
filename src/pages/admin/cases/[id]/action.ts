import type { APIRoute } from "astro";
import { csrfOk } from "../../../../lib/cases/auth";
import { isCaseId } from "../../../../lib/cases/cases";
import { redirect, setFlash } from "../../../../lib/cases/http";
import { runCaseAction } from "../../../../lib/cases/actions";

export const prerender = false;

export const POST: APIRoute = async ({ params, request, locals, cookies }) => {
  const session = locals.session;
  const id = String(params.id ?? "");
  if (!session || !isCaseId(id)) return new Response("Not found", { status: 404 });
  const form = await request.formData();
  if (!csrfOk(session, form.get("_csrf"))) {
    setFlash(cookies, { ok: false, message: "Your session form expired. Reload the page and try again." });
    return redirect(`/admin/cases/${id}`);
  }
  const result = await runCaseAction(id, form, session);
  setFlash(cookies, { ok: result.ok, message: result.message });
  const back = result.ok && result.redirect ? result.redirect : `/admin/cases/${id}${String(form.get("_back") ?? "")}`;
  return redirect(back.startsWith("/admin") ? back : `/admin/cases/${id}`);
};
