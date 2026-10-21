// Daily: poll BoldSign for open envelopes (works without the webhook) and remind about stale cases.
import type { APIRoute } from "astro";
import { getCase, listCases } from "../../../lib/cases/cases";
import { config } from "../../../lib/cases/config";
import { bearerOk, notFound } from "../../../lib/cases/http";
import { notifyAdmins } from "../../../lib/cases/mail";
import { refreshSignature } from "../../../lib/cases/workflow";

export const prerender = false;

const DAY = 86_400_000;

export const GET: APIRoute = async ({ request }) => {
  if (!config.enabled()) return notFound();
  if (!bearerOk(request, config.cronSecret())) return new Response("Unauthorized", { status: 401 });
  const started = Date.now();
  const cases = (await listCases()).filter((e) => e.state === "active");
  let polled = 0;
  const stale: string[] = [];
  for (const entry of cases) {
    if (Date.now() - started > 45_000) break;
    const age = (iso?: string) => (iso ? (Date.now() - Date.parse(iso)) / DAY : 0);
    if (entry.status === "signatures_completed") {
      try {
        const c = await refreshSignature(entry.id, "daily check");
        polled++;
        if (!c.milestones.signatures_completed && age(c.milestones.sent_for_signature?.at) > 7) stale.push(`${entry.id} ${entry.company}: out for signature for ${Math.floor(age(c.milestones.sent_for_signature?.at))} days`);
      } catch (err) {
        console.error("[cases] cron poll failed", entry.id, (err as Error).message);
      }
      continue;
    }
    if (entry.status === "details_confirmed" && age(entry.createdAt) > 2) {
      stale.push(`${entry.id} ${entry.company || "(no company yet)"}: details not confirmed after ${Math.floor(age(entry.createdAt))} days`);
    }
    if (["award_notary_meeting", "award_notarized"].includes(entry.status)) {
      const c = await getCase(entry.id);
      const since = c?.milestones.signed_pack_emailed?.at ?? c?.milestones.signatures_completed?.at;
      if (age(since) > 14) stale.push(`${entry.id} ${entry.company}: Award Letter not notarized ${Math.floor(age(since))} days after signing`);
    }
  }
  if (stale.length) {
    await notifyAdmins(`Sterling cases: ${stale.length} need attention`, ["These cases have been waiting a while:", ...stale.map((s) => `• ${s}`)], `${config.siteUrl()}/admin`);
  }
  console.log(`[cases] cron: ${cases.length} active, ${polled} polled, ${stale.length} stale`);
  return Response.json({ ok: true, active: cases.length, polled, stale: stale.length });
};
