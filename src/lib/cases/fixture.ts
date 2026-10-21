// Fictional test data for rendering checks. No real person or company.
import type { Fields } from "./schema";
import { applyDefaults } from "./derive";

export const FIXTURE_REFERENCE = "SPG-2026-0000";

export function fixtureFields(variant: { survivor?: boolean; existing?: boolean; cents?: boolean } = {}): Fields {
  return applyDefaults({
    company_name: "Example Holdings LLC",
    state_of_formation: "Wyoming",
    formation_date: "2025-03-14",
    state_filing_id: "2025-001234567",
    ein: "99-0000000",
    principal_office_address: "30 N Gould St, Ste 100\nSheridan, WY 82801, USA",
    registered_agent_name: "Example Registered Agents Inc.",
    registered_agent_address: "30 N Gould St, Ste 200, Sheridan, WY 82801, USA",
    existing_llc: Boolean(variant.existing),
    ...(variant.existing ? { prior_oa_date: "2025-03-20" } : {}),
    capital_amount: variant.cents ? "1000000.50" : "125000",
    successors: variant.existing ? "Jane Example and John Example" : undefined,
    member_name: "Alex Example",
    member_address: "1 Sample Street\n10115 Sampletown\nExampleland",
    member_email: "alex@example.com",
    beneficiary_salutation: "Mx.",
    beneficiary_dob: "1961-05-02",
    beneficiary_nationality: "Fictional",
    beneficiary_passport: "X0000000",
    beneficiary_role: "Managing Member",
    service_start_date: "2025-03-14",
    monthly_amount: variant.cents ? "2500.50" : "2500",
    commencement_date: "2026-12-01",
    has_survivor: Boolean(variant.survivor),
    ...(variant.survivor
      ? { survivor_name: "Sam Example", survivor_dob: "1963-08-21", survivor_relationship: "spouse" }
      : {}),
    fund_bank: "Mercury",
    fund_amount: "750000",
    signing_date: "2026-11-02",
    award_letter_date: "2026-11-02",
    certificate_date: "2027-02-15",
    first_payment_date: "2026-12-01",
  });
}
