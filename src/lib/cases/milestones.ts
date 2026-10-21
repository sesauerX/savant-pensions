// Case milestones (spec §3), the status derived from them, and server-side guards.
import type { Case } from "./types";

export const MILESTONES = [
  { key: "received", label: "Received", next: "Review the extracted details", auto: true },
  { key: "details_confirmed", label: "Details confirmed", next: "Review and confirm details", auto: false },
  { key: "documents_generated", label: "Documents generated", next: "Generate documents", auto: true },
  { key: "sent_for_signature", label: "Sent for signature", next: "Send for signature", auto: false },
  { key: "signatures_completed", label: "Signatures completed", next: "Waiting for signatures", auto: true },
  { key: "signed_pack_emailed", label: "Signed pack emailed (A)", next: "Email signed documents (A)", auto: true },
  { key: "award_notary_meeting", label: "Award: notary meeting", next: "Book the Award Letter notary meeting", auto: false },
  { key: "award_notarized", label: "Award: notarized", next: "Upload the notarized Award Letter", auto: false },
  { key: "award_ecopies_emailed", label: "Award: e-copies emailed (B)", next: "Email Award Letter e-copies (B)", auto: false },
  { key: "award_couriered", label: "Award: couriered", next: "Enter Award Letter courier tracking", auto: false },
  { key: "first_payment_confirmed", label: "First payment confirmed", next: "Waiting for the first pension payment", auto: false },
  { key: "certificate_generated", label: "Certificate generated", next: "Generate the certificate", auto: true },
  { key: "certificate_notary_meeting", label: "Certificate: notary meeting", next: "Book the certificate notary meeting", auto: false },
  { key: "certificate_notarized", label: "Certificate: notarized", next: "Upload the notarized certificate", auto: false },
  { key: "final_pack_emailed", label: "Final pack emailed (C)", next: "Email certificate and full set (C)", auto: false },
  { key: "certificate_couriered", label: "Certificate: couriered", next: "Enter certificate courier tracking", auto: false },
  { key: "closed", label: "Closed", next: "Close the case", auto: false },
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

const WAITING: MilestoneKey[] = ["signatures_completed", "first_payment_confirmed"];

export function caseStatus(c: Pick<Case, "milestones" | "state">): StatusInfo {
  if (c.state === "cancelled") return { key: "cancelled", label: "Cancelled", next: "–", tone: "stop" };
  if (c.state === "on_hold") return { key: "on_hold", label: "On hold", next: "Resume when ready", tone: "hold" };
  const m = currentMilestone(c);
  if (!m || c.state === "closed") return { key: "closed", label: "Closed", next: "–", tone: "done" };
  const def = MILESTONE_BY_KEY[m];
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
    case "first_payment_confirmed": return "Awaiting 1st payment";
    case "certificate_generated": return "Certificate to generate";
    case "certificate_notary_meeting":
    case "certificate_notarized": return "Awaiting notary (Certificate)";
    case "final_pack_emailed": return "Final pack to send";
    case "certificate_couriered": return "Certificate courier pending";
    case "closed": return "Ready to close";
  }
}

/** Filter buckets for the case list. */
export function statusBucket(status: string, state: string) {
  if (state === "on_hold") return "on_hold";
  if (state === "closed" || state === "cancelled" || status === "closed") return "closed";
  if (status === "signatures_completed") return "waiting_client";
  if (status === "first_payment_confirmed") return "waiting_payment";
  return "active";
}

export const COUNTERS = [
  { key: "review", label: "Needs review", match: (s: string) => s === "details_confirmed" },
  { key: "signature", label: "Out for signature", match: (s: string) => s === "signatures_completed" },
  {
    key: "notary",
    label: "Awaiting notary",
    match: (s: string) => ["award_notary_meeting", "award_notarized", "certificate_notary_meeting", "certificate_notarized"].includes(s),
  },
  { key: "payment", label: "Awaiting 1st payment", match: (s: string) => s === "first_payment_confirmed" },
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
