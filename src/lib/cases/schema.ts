// Case fields (spec §5.1): definitions, validation and normalisation.
// Dates are stored as ISO YYYY-MM-DD, amounts as plain numeric strings, booleans as booleans.

export type FieldType = "text" | "textarea" | "date" | "amount" | "bool" | "email" | "ein" | "select";
export type FieldGroup = "Company" | "Member" | "Beneficiary" | "Pension" | "Survivor" | "Fund" | "Dates";

/**
 * required: true = always; a string = required when that boolean field is true;
 * "stage" = only required at a later stage.
 */
export type FieldDef = {
  key: string;
  label: string;
  group: FieldGroup;
  type: FieldType;
  required: true | false | "existing_llc" | "has_survivor" | "stage";
  options?: string[];
  hint?: string;
  /** Wording for the "request missing details" email, per client language. */
  ask?: { en: string; de: string };
};

export const FIELDS: FieldDef[] = [
  { key: "company_name", label: "Company name", group: "Company", type: "text", required: true, hint: "Exact legal name incl. LLC" },
  { key: "state_of_formation", label: "State of formation", group: "Company", type: "text", required: true },
  { key: "formation_date", label: "Formation date", group: "Company", type: "date", required: true, ask: { en: "Formation date of the company", de: "Gründungsdatum der Gesellschaft" } },
  { key: "state_filing_id", label: "State filing number", group: "Company", type: "text", required: true, ask: { en: "State filing number of the company", de: "Registernummer der Gesellschaft (State Filing Number)" } },
  { key: "ein", label: "EIN", group: "Company", type: "ein", required: true, hint: "12-3456789", ask: { en: "Employer Identification Number (EIN) of the company", de: "Steuernummer der Gesellschaft (Employer Identification Number, EIN)" } },
  { key: "principal_office_address", label: "Principal office address", group: "Company", type: "textarea", required: true, ask: { en: "Principal office address of the company", de: "Anschrift des Hauptsitzes der Gesellschaft" } },
  { key: "registered_agent_name", label: "Registered agent", group: "Company", type: "text", required: true, ask: { en: "Name of the company's registered agent", de: "Name des Registered Agent der Gesellschaft" } },
  { key: "registered_agent_address", label: "Registered agent address", group: "Company", type: "textarea", required: true, ask: { en: "Address of the company's registered agent", de: "Anschrift des Registered Agent der Gesellschaft" } },
  { key: "existing_llc", label: "LLC existed before (amend & restate)?", group: "Company", type: "bool", required: true },
  { key: "prior_oa_date", label: "Date of prior operating agreement", group: "Company", type: "date", required: "existing_llc", ask: { en: "Date of the company's previous operating agreement", de: "Datum des bisherigen Gesellschaftsvertrags (Operating Agreement)" } },
  { key: "capital_amount", label: "Capital contributed (USD)", group: "Company", type: "amount", required: true, ask: { en: "Capital you contributed to the company (USD)", de: "Ihre Kapitaleinlage in die Gesellschaft (USD)" } },
  { key: "llc_act", label: "Name of the state LLC Act", group: "Company", type: "text", required: true, hint: "Default from state; counsel to confirm" },
  { key: "secretary_of_state", label: "Filing office", group: "Company", type: "text", required: true, hint: "Default from state; counsel to confirm" },
  { key: "successors", label: "Named successors/heirs", group: "Member", type: "text", required: false, hint: "Optional, OA 4.5(a)", ask: { en: "Names of any successors or heirs to be named", de: "Namen etwaiger zu benennender Rechtsnachfolger oder Erben" } },
  { key: "member_name", label: "Sole member full legal name", group: "Member", type: "text", required: true },
  { key: "member_address", label: "Member residential address", group: "Member", type: "textarea", required: true, ask: { en: "Your residential address", de: "Ihre Wohnanschrift" } },
  { key: "member_email", label: "Member email (the client)", group: "Member", type: "email", required: true },
  { key: "client_language", label: "Client email language", group: "Member", type: "select", required: true, options: ["en", "de"], hint: "Emails only; documents stay English" },
  { key: "beneficiary_name", label: "Beneficiary full legal name", group: "Beneficiary", type: "text", required: true },
  { key: "beneficiary_salutation", label: "Salutation", group: "Beneficiary", type: "select", required: true, options: ["Ms.", "Mr.", "Mx."] },
  { key: "beneficiary_surname", label: "Surname", group: "Beneficiary", type: "text", required: true },
  { key: "beneficiary_dob", label: "Date of birth", group: "Beneficiary", type: "date", required: true, ask: { en: "Your date of birth", de: "Ihr Geburtsdatum" } },
  { key: "beneficiary_nationality", label: "Nationality (adjective)", group: "Beneficiary", type: "text", required: true, hint: "e.g. German", ask: { en: "Your nationality", de: "Ihre Staatsangehörigkeit" } },
  { key: "beneficiary_passport", label: "Passport number", group: "Beneficiary", type: "text", required: true, ask: { en: "Your passport number", de: "Ihre Reisepassnummer" } },
  { key: "beneficiary_address", label: "Residential address (courier address)", group: "Beneficiary", type: "textarea", required: true, ask: { en: "Address for delivery of the original documents", de: "Lieferanschrift für die Originaldokumente" } },
  { key: "beneficiary_role", label: "Role served", group: "Beneficiary", type: "text", required: true, hint: "e.g. Managing Member", ask: { en: "Your role in the company", de: "Ihre Funktion in der Gesellschaft" } },
  { key: "apostille_sets", label: "Apostilled original sets", group: "Beneficiary", type: "text", required: false, hint: "Number of sets", ask: { en: "Number of apostilled original sets", de: "Anzahl der apostillierten Originalsätze" } },
  { key: "service_start_date", label: "Service start date", group: "Beneficiary", type: "date", required: true, ask: { en: "Start date of your service to the company", de: "Beginn Ihrer Tätigkeit für die Gesellschaft" } },
  { key: "monthly_amount", label: "Monthly pension (USD)", group: "Pension", type: "amount", required: true },
  { key: "commencement_date", label: "First payment date", group: "Pension", type: "date", required: true, hint: "The pension start date, often given as \"Start date\"" },
  { key: "adjustment_date", label: "Annual adjustment date", group: "Pension", type: "text", required: true },
  { key: "adjustment_index", label: "Index", group: "Pension", type: "textarea", required: true },
  { key: "has_survivor", label: "Survivor named?", group: "Survivor", type: "bool", required: true },
  { key: "survivor_name", label: "Survivor full legal name", group: "Survivor", type: "text", required: "has_survivor", ask: { en: "Full legal name of your survivor (spouse or partner)", de: "Vollständiger Name der hinterbliebenen Person (Ehe- oder Lebenspartner)" } },
  { key: "survivor_dob", label: "Survivor date of birth", group: "Survivor", type: "date", required: "has_survivor", ask: { en: "Date of birth of your survivor", de: "Geburtsdatum der hinterbliebenen Person" } },
  { key: "survivor_relationship", label: "Relationship", group: "Survivor", type: "select", required: "has_survivor", options: ["spouse", "partner"] },
  { key: "fund_bank", label: "Bank holding Designated Fund", group: "Fund", type: "text", required: true, hint: "e.g. Mercury", ask: { en: "Bank holding the Designated Fund", de: "Bank, bei der der Pensionsfonds (Designated Fund) geführt wird" } },
  { key: "fund_amount", label: "Designated Fund amount (USD)", group: "Fund", type: "amount", required: true, ask: { en: "Amount of the Designated Fund (USD)", de: "Höhe des Pensionsfonds (Designated Fund) in USD" } },
  { key: "signing_date", label: "Date of signing", group: "Dates", type: "date", required: true },
  { key: "award_letter_date", label: "Award letter date", group: "Dates", type: "date", required: true, hint: "Defaults to signing date; may move to the notary meeting date" },
];

export const FIELD_KEYS = FIELDS.map((f) => f.key);
export const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f])) as Record<string, FieldDef>;
export const GROUPS: FieldGroup[] = ["Company", "Member", "Beneficiary", "Pension", "Survivor", "Fund", "Dates"];

export type Fields = Record<string, string | boolean | undefined>;

export const DEFAULT_ADJUSTMENT_DATE = "1 January";
export const DEFAULT_ADJUSTMENT_INDEX =
  "Consumer Price Index for All Urban Consumers (CPI-U), published by the US Bureau of Labor Statistics";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const MONTHS_DE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

/** ISO date to "1. Januar 2027". */
export function formatDateDe(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`not an ISO date: ${iso}`);
  return `${Number(m[3])}. ${MONTHS_DE[Number(m[2]) - 1]} ${m[1]}`;
}

/** ISO date to "January 15, 2026". */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`not an ISO date: ${iso}`);
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

export function isIsoDate(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function todayIso(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  // Business dates follow US Eastern time (West Hartford).
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Best-effort normalisation of one raw value. Returns undefined for empty. */
export function normaliseValue(def: FieldDef, raw: unknown): string | boolean | undefined {
  if (def.type === "bool") {
    if (typeof raw === "boolean") return raw;
    const s = String(raw ?? "").trim().toLowerCase();
    if (["true", "yes", "on", "1"].includes(s)) return true;
    if (["false", "no", "off", "0"].includes(s)) return false;
    return undefined;
  }
  if (raw === null || raw === undefined) return undefined;
  let s = String(raw).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim();
  if (def.type !== "textarea") s = s.replace(/\s+/g, " ");
  else s = s.replace(/\r\n/g, "\n").replace(/\n{2,}/g, "\n");
  if (!s) return undefined;
  if (s.length > 2000) s = s.slice(0, 2000);
  if (def.type === "amount") {
    const n = s.replace(/[$,\s]|usd/gi, "");
    if (/^\d+(\.\d{1,2})?$/.test(n)) return n.replace(/^0+(?=\d)/, "").replace(/\.0+$/, "");
    return s;
  }
  if (def.type === "date") {
    if (isIsoDate(s)) return s;
    const parsed = new Date(`${s} UTC`);
    if (!Number.isNaN(parsed.getTime()) && /[a-z]/i.test(s)) return parsed.toISOString().slice(0, 10);
    return s;
  }
  if (def.type === "email") return s.toLowerCase();
  if (def.type === "ein") {
    const digits = s.replace(/\D/g, "");
    if (digits.length === 9) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    return s;
  }
  return s;
}

/** Validation errors for one field value (format only; presence is checked by missingFields). */
export function fieldError(def: FieldDef, value: unknown): string | null {
  if (value === undefined || value === "") return null;
  switch (def.type) {
    case "date":
      return isIsoDate(String(value)) ? null : "Use a valid date";
    case "amount":
      return /^\d+(\.\d{1,2})?$/.test(String(value)) ? null : "Use a plain amount, e.g. 2500 or 2500.50";
    case "email":
      return EMAIL_RE.test(String(value)) ? null : "Use a valid email address";
    case "ein":
      return /^\d{2}-\d{7}$/.test(String(value)) ? null : "EIN format is 12-3456789";
    case "select":
      return def.options?.includes(String(value)) ? null : `Choose one of: ${def.options?.join(", ")}`;
    case "bool":
      return typeof value === "boolean" ? null : "Choose yes or no";
    default:
      return null;
  }
}

function isRequired(def: FieldDef, fields: Fields) {
  if (def.required === true) return true;
  if (def.required === "existing_llc") return fields.existing_llc === true;
  if (def.required === "has_survivor") return fields.has_survivor === true;
  return false;
}

/** Keys of required fields that are empty (stage fields excluded). */
export function missingFields(fields: Fields): string[] {
  return FIELDS.filter((def) => isRequired(def, fields)).filter((def) => {
    const v = fields[def.key];
    return v === undefined || v === "";
  }).map((def) => def.key);
}

/** All validation errors, keyed by field. */
export function validateFields(fields: Fields): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const def of FIELDS) {
    const err = fieldError(def, fields[def.key]);
    if (err) errors[def.key] = err;
  }
  return errors;
}

/** Normalise a whole raw object (form post or extraction output). Unknown keys are dropped. */
export function normaliseFields(raw: Record<string, unknown>): Fields {
  const out: Fields = {};
  for (const def of FIELDS) {
    if (!(def.key in raw)) continue;
    const v = normaliseValue(def, raw[def.key]);
    if (v !== undefined) out[def.key] = v;
  }
  return out;
}
