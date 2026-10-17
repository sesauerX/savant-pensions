// Link lists shared by sidebars and hubs. Labels are the site's existing link text.
export const resources: [string, string][] = [
  ["/limits", "2024–2026 IRS limits"],
  ["/compare", "Compare SEP, 401(k), pension"],
  ["/illustrations", "Illustrative contributions"],
  ["/not-a-fit", "When it is not a fit"],
  ["/staff-cost", "Staff cost"],
  ["/calendar", "Deadline calendar"],
  ["/fees", "Fees and who does what"],
  ["/plan-lifecycle", "After the plan exists"],
  ["/calculator", "Tax savings calculator"],
  ["/faq", "FAQs"],
];

export const industries: { href: string; label: string; slot: string }[] = [
  { href: "/physicians", label: "Physicians", slot: "physicians-card" },
  { href: "/dentists", label: "Dentists", slot: "dentists-card" },
  { href: "/attorneys", label: "Law firms", slot: "attorneys-card" },
  { href: "/consultants", label: "Consultants", slot: "consultants-card" },
];

export const services: [string, string][] = [
  ["/services", "Services"],
  ["/administration", "Administration"],
  ["/compliance", "Compliance"],
  ["/plan-lifecycle", "After the plan exists"],
  ["/staff-cost", "Staff cost"],
  ["/case-studies", "Case studies"],
];
