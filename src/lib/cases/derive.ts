// Derived values and defaults. Derived values are computed at render time and never stored.
import {
  DEFAULT_ADJUSTMENT_DATE,
  DEFAULT_ADJUSTMENT_INDEX,
  FIELDS,
  formatDate,
  todayIso,
  type Fields,
} from "./schema";
import { amountToWords, formatAmount, integerToWords } from "./words";

// Defaults for the LLC Act and the filing office (spec §6.4). Counsel to confirm; editable per case.
const KNOWN_STATES = [
  "Wyoming", "Delaware", "New Mexico", "Nevada", "Florida", "Texas", "Colorado", "Connecticut", "Montana", "South Dakota",
];
const LLC_ACT: Record<string, string> = {
  Florida: "Florida Revised Limited Liability Company Act",
  Texas: "Texas Business Organizations Code",
};
const FILING_OFFICE: Record<string, string> = {
  Delaware: "Delaware Secretary of State, Division of Corporations",
};

/** Canonical state name ("wyoming", "WY " -> "Wyoming") when it is one of the known states. */
export function canonicalState(state: string) {
  const s = state.trim().toLowerCase();
  const abbr: Record<string, string> = { wy: "Wyoming", de: "Delaware", nm: "New Mexico", nv: "Nevada", fl: "Florida", tx: "Texas", co: "Colorado", ct: "Connecticut", mt: "Montana", sd: "South Dakota" };
  return KNOWN_STATES.find((k) => k.toLowerCase() === s) ?? abbr[s] ?? state.trim();
}

export function defaultLlcAct(state: string) {
  const st = canonicalState(state);
  return LLC_ACT[st] ?? `${st} Limited Liability Company Act`;
}

export function defaultFilingOffice(state: string) {
  const st = canonicalState(state);
  return FILING_OFFICE[st] ?? `Secretary of State of the State of ${st}`;
}

/** Fill sensible defaults for empty fields (never overwrites a value). */
export function applyDefaults(fields: Fields): Fields {
  const f: Fields = { ...fields };
  const empty = (k: string) => f[k] === undefined || f[k] === "";
  if (typeof f.state_of_formation === "string" && f.state_of_formation) {
    f.state_of_formation = canonicalState(f.state_of_formation);
    if (empty("llc_act")) f.llc_act = defaultLlcAct(f.state_of_formation);
    if (empty("secretary_of_state")) f.secretary_of_state = defaultFilingOffice(f.state_of_formation);
  }
  if (empty("beneficiary_name") && f.member_name) f.beneficiary_name = f.member_name;
  if (empty("beneficiary_surname") && typeof f.beneficiary_name === "string" && f.beneficiary_name) {
    f.beneficiary_surname = f.beneficiary_name.trim().split(/\s+/).pop();
  }
  if (empty("beneficiary_address") && f.member_address) f.beneficiary_address = f.member_address;
  if (empty("client_language")) f.client_language = "en";
  if (empty("adjustment_date")) f.adjustment_date = DEFAULT_ADJUSTMENT_DATE;
  if (empty("adjustment_index")) f.adjustment_index = DEFAULT_ADJUSTMENT_INDEX;
  return f;
}

/** Defaults set when Pocholo opens the confirm step. */
export function confirmDefaults(fields: Fields): Fields {
  const f = applyDefaults(fields);
  if (!f.signing_date) f.signing_date = todayIso(2);
  if (!f.award_letter_date) f.award_letter_date = f.signing_date;
  return f;
}

/** One-line form of a multi-line address. */
function oneLine(value: string) {
  return value.split(/\n+/).map((s) => s.trim().replace(/,$/, "")).filter(Boolean).join(", ");
}

/**
 * Values for the templates: dates printed as "January 15, 2026", amounts as "2,500",
 * plus `*_words`, `reference` and the short index name. Empty fields stay absent so
 * the renderer can report them.
 */
export type CertificateValues = {
  variant: "onboarding" | "payment_history";
  certificate_date: string;
  payments_made?: number;
  last_payment_date?: string;
};

export function templateValues(
  fields: Fields,
  reference: string,
  flags: { showPassport: boolean; withTags?: boolean; certificate?: CertificateValues },
) {
  const v: Record<string, string | boolean> = { reference };
  for (const def of FIELDS) {
    const raw = fields[def.key];
    if (raw === undefined || raw === "") continue;
    if (def.type === "bool") v[def.key] = raw === true;
    else if (def.type === "date") v[def.key] = formatDate(String(raw));
    else if (def.type === "amount") {
      v[def.key] = formatAmount(String(raw));
      v[`${def.key}_words`] = amountToWords(String(raw));
    } else if (def.type === "textarea") {
      v[def.key] = oneLine(String(raw));
      v[`${def.key}_lines`] = String(raw);
    } else v[def.key] = String(raw);
  }
  v.adjustment_index_short = "CPI-U";
  v.show_passport = flags.showPassport;
  v.with_tags = Boolean(flags.withTags);
  // Long company names get a smaller letterhead line so they wrap at most once.
  v.letterhead_name_class = String(fields.company_name ?? "").length > 36 ? "co-name long" : "co-name";
  const cert = flags.certificate;
  if (cert) {
    v.is_onboarding = cert.variant === "onboarding";
    v.certificate_date = formatDate(cert.certificate_date);
    if (cert.variant === "payment_history") {
      if (cert.payments_made) {
        v.payments_made = String(cert.payments_made);
        v.payments_made_words = integerToWords(cert.payments_made);
      }
      if (cert.last_payment_date) v.last_payment_date = formatDate(cert.last_payment_date);
    }
  }
  return v;
}
