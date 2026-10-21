// Case milestones (spec §3), the status derived from them, and server-side guards.
import type { Case } from "./types";

export const MILESTONES = [
  { key: "received", label: "Received", next: "Review the extracted details", auto: true },
  { key: "details_confirmed", label: "Details confirmed", next: "Review and confirm details", auto: false },
  { key: "documents_generated", label: "Documents 1–4 and certificate C1 generated", next: "Generate documents", auto: true },
  { key: "sent_for_signature", label: "Sent for signature", next: "Send for signature", auto: false },
  { key: "signatures_completed", label: "Signatures completed (5 documents)", next: "Waiting for signatures", auto: true },
  { key: "signed_pack_emailed", label: "Signed pack emailed (A)", next: "Email signed documents (A)", auto: true },
  { key: "award_notary_meeting", label: "Award: notary meeting", next: "Book the Award Letter notary meeting", auto: false },
  { key: "award_notarized", label: "Award: notarized", next: "Upload the notarized Award Letter", auto: false },
  { key: "award_ecopies_emailed", label: "Award: e-copies emailed (B)", next: "Email Award Letter e-copies (B)", auto: false },
  { key: "award_couriered", label: "Award: couriered", next: "Enter Award Letter courier tracking", auto: false },
  { key: "closed", label: "Closed", next: "Issue payment certificates as needed, or close", auto: false },
] as const;

export type MilestoneKey = (typeof MILESTONES)[number]["key"];
export const MILESTONE_KEYS = MILESTONES.map((m) => m.key) as MilestoneKey[];
export const MILESTONE_BY_KEY = Object.fromEntries(MILESTONES.map((m) => [m.key, m])) as Record<
  MilestoneKey,
  (typeof MILESTONES)[number]
>;

/** First milestone not yet done; null when everything is done. */
export function currentMilestone(c: Pick<Case, "milestones">): MilestoneKey | null {
  return MILESTONE_KEYS.find((k) => !c.milestones[k]) ?? null;
}

export type StatusInfo = { key: string; label: string; next: string; tone: "info" | "wait" | "action" | "done" | "hold" | "stop" };

const WAITING: MilestoneKey[] = ["signatures_completed"];

export function caseStatus(c: Pick<Case, "milestones" | "state">): StatusInfo {
  if (c.state === "cancelled") return { key: "cancelled", label: "Cancelled", next: "–", tone: "stop" };
  if (c.state === "on_hold") return { key: "on_hold", label: "On hold", next: "Resume when ready", tone: "hold" };
  const m = currentMilestone(c);
  if (!m || c.state === "closed") return { key: "closed", label: "Closed", next: "–", tone: "done" };
  const def = MILESTONE_BY_KEY[m];
  // Onboarding done: the case stays open for later payment certificates until it is closed.
  if (m === "closed") return { key: "onboarding_complete", label: "Onboarding complete", next: def.next, tone: "wait" };
  return { key: m, label: statusLabel(m), next: def.next, tone: WAITING.includes(m) ? "wait" : m === "details_confirmed" ? "action" : "info" };
}

/** Status names read as "what is happening now". */
function statusLabel(m: MilestoneKey) {
  switch (m) {
    case "received": return "Received";
    case "details_confirmed": return "Needs review";
    case "documents_generated": return "Generating documents";
    case "sent_for_signature": return "Ready to send";
    case "signatures_completed": return "Out for signature";
    case "signed_pack_emailed": return "Signed – email A pending";
    case "award_notary_meeting":
    case "award_notarized": return "Awaiting notary (Award)";
    case "award_ecopies_emailed": return "Award e-copies to send";
    case "award_couriered": return "Award courier pending";
    case "closed": return "Onboarding complete";
  }
}

/** Filter buckets for the case list. */
export function statusBucket(status: string, state: string) {
  if (state === "on_hold") return "on_hold";
  if (state === "closed" || state === "cancelled" || status === "closed") return "closed";
  if (status === "signatures_completed") return "waiting_client";
  if (status === "onboarding_complete") return "waiting_payment";
  return "active";
}

export const COUNTERS = [
  { key: "review", label: "Needs review", match: (s: string) => s === "details_confirmed" },
  { key: "signature", label: "Out for signature", match: (s: string) => s === "signatures_completed" },
  {
    key: "notary",
    label: "Awaiting notary",
    match: (s: string) => ["award_notary_meeting", "award_notarized"].includes(s),
  },
  { key: "payment", label: "Onboarding complete", match: (s: string) => s === "onboarding_complete" },
];

export class GuardError extends Error {}

export function requireMilestones(c: Case, keys: MilestoneKey[], what: string) {
  const missing = keys.filter((k) => !c.milestones[k]);
  if (missing.length) {
    throw new GuardError(`${what} needs: ${missing.map((k) => MILESTONE_BY_KEY[k].label).join(", ")}.`);
  }
}

export function requireActive(c: Case) {
  if (c.state !== "active") throw new GuardError(`This case is ${c.state.replace("_", " ")}. Resume it first.`);
}
