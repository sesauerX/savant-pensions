export const SITE = "https://sterlingpensiongroup.com";

export type PageSeo = { title: string; description: string; crumb: string };

export const pages: Record<string, PageSeo> = {
  "/": {
    crumb: "Home",
    title: "Pension Plan Administrator for Business Owners | Sterling Pension Group",
    description:
      "Sterling Pension Group is a pension plan administrator for business owners. We design and administer Defined Benefit and Cash Balance plans.",
  },
  "/defined-benefit": {
    crumb: "Defined Benefit",
    title: "Defined Benefit Plans for Business Owners | Sterling Pension Group",
    description:
      "Defined benefit plan design and administration for business owners who need a larger deductible contribution than a 401(k) allows.",
  },
  "/cash-balance": {
    crumb: "Cash Balance",
    title: "Cash Balance Plans for Business Owners | Sterling Pension Group",
    description:
      "Cash balance plan design and third-party administration for owners who want a defined benefit plan they can track as an account.",
  },
  "/services": {
    crumb: "Services",
    title: "Pension Plan Administration Services | Sterling Pension Group",
    description:
      "Plan design, third-party administration, and compliance support for Defined Benefit and Cash Balance plans. Sterling is not the actuary.",
  },
  "/about": {
    crumb: "About",
    title: "About Sterling Pension Group, Plan Administrator",
    description:
      "Sterling Pension Group LLC is an independent third-party administrator for Defined Benefit and Cash Balance plans, based in West Hartford, Connecticut.",
  },
  "/contact": {
    crumb: "Contact",
    title: "Contact a Pension Plan Administrator | Sterling Pension Group",
    description:
      "Talk with Sterling Pension Group about Defined Benefit or Cash Balance administration. Call (860) 590-7172 or send compensation and a census.",
  },
  "/insights": {
    crumb: "Insights",
    title: "Pension Insights for Business Owners | Sterling Pension Group",
    description:
      "IRS limits, deadlines, and a briefing every two weeks for self-employed owners considering a cash balance or defined benefit plan.",
  },
  "/insights/archive": {
    crumb: "Briefing archive",
    title: "Owner Briefing Archive | Sterling Pension Group",
    description:
      "Every Sterling Pension Group briefing since September 2024, one note every two weeks, listed by date.",
  },
  "/self-employed": {
    crumb: "Self-employed",
    title: "Self-Employed Cash Balance Plans | Sterling Pension Group",
    description:
      "Cash balance and defined benefit administration for self-employed owners who have outgrown a SEP IRA or a solo 401(k).",
  },
  "/combo": {
    crumb: "401(k) combo",
    title: "401(k) and Cash Balance Combo Plans | Sterling Pension Group",
    description:
      "How a 401(k) and a cash balance plan work together, including combined testing, staff cost, and what the owner can still defer.",
  },
  "/physicians": {
    crumb: "Physicians",
    title: "Cash Balance Plans for Physicians | Sterling Pension Group",
    description:
      "Defined benefit and cash balance administration for medical practices, including staff cost and owner-level contributions.",
  },
  "/dentists": {
    crumb: "Dentists",
    title: "Cash Balance Plans for Dentists | Sterling Pension Group",
    description:
      "Cash balance plan administration for dental practices that have filled a 401(k) and want a larger deductible contribution.",
  },
  "/attorneys": {
    crumb: "Law firms",
    title: "Cash Balance Plans for Law Firms | Sterling Pension Group",
    description:
      "Cash balance and defined benefit administration for small law firms with partners of different ages and compensation.",
  },
  "/consultants": {
    crumb: "Consultants",
    title: "Cash Balance Plans for Consultants | Sterling Pension Group",
    description:
      "Pension plan administration for independent consultants whose SEP or solo 401(k) no longer holds the contribution they want.",
  },
  "/limits": {
    crumb: "IRS limits",
    title: "2024–2026 IRS Retirement Plan Limits | Sterling Pension Group",
    description:
      "Elective deferral, catch-up, annual addition, compensation cap, and defined benefit dollar limits for 2024, 2025, and 2026.",
  },
  "/compare": {
    crumb: "Compare plans",
    title: "SEP vs Solo 401(k) vs Cash Balance | Sterling Pension Group",
    description:
      "Compare a SEP, a solo 401(k), and a cash balance plan once owner income is already past the standard 401(k) ceiling.",
  },
  "/illustrations": {
    crumb: "Illustrations",
    title: "Illustrative Cash Balance Contributions | Sterling Pension Group",
    description:
      "Age-based cash balance contribution illustrations. These are examples, not IRS limits and not a quote for your company.",
  },
  "/not-a-fit": {
    crumb: "Not a fit",
    title: "When a Cash Balance Plan Is Not a Fit | Sterling Pension Group",
    description:
      "Income, staff, and timing cases where a defined benefit or cash balance plan should wait. The pension is often the wrong tool.",
  },
  "/staff-cost": {
    crumb: "Staff cost",
    title: "Cash Balance Plan Staff Cost | Sterling Pension Group",
    description:
      "Why employees, hours, and ownership decide the real cost of a cash balance plan, not the owner-only figure in an advertisement.",
  },
  "/calendar": {
    crumb: "Deadlines",
    title: "Pension Plan Deadline Calendar | Sterling Pension Group",
    description:
      "Form 5500, minimum funding, and the employer deduction date. Three different clocks for a calendar-year defined benefit plan.",
  },
  "/fees": {
    crumb: "Fees",
    title: "Pension Plan Administration Fees | Sterling Pension Group",
    description:
      "What you pay a third-party administrator, an enrolled actuary, a recordkeeper, and a trustee, and which party does which job.",
  },
  "/plan-lifecycle": {
    crumb: "Plan lifecycle",
    title: "After the Cash Balance Plan Exists | Sterling Pension Group",
    description:
      "A soft year, a new hire, a practice sale, and how a defined benefit plan is frozen or terminated. What happens after adoption.",
  },
  "/calculator": {
    crumb: "Calculator",
    title: "Cash Balance Contribution Calculator | Sterling Pension Group",
    description:
      "Sketch defined benefit contribution room from age and pay. An illustration only, not a deductible contribution and not a quote.",
  },
  "/faq": {
    crumb: "FAQs",
    title: "Cash Balance and Defined Benefit FAQs | Sterling Pension Group",
    description:
      "Who these plans fit, whether you can keep a 401(k), and whether cash balance contributions are required every year.",
  },
  "/administration": {
    crumb: "Administration",
    title: "Third-Party Pension Administration | Sterling Pension Group",
    description:
      "Ongoing administration for Defined Benefit and Cash Balance plans: census, valuations, government filings, and the work after adoption.",
  },
  "/compliance": {
    crumb: "Compliance",
    title: "Defined Benefit Plan Compliance | Sterling Pension Group",
    description:
      "Coverage, nondiscrimination, Form 5500, and the annual work that keeps a cash balance or defined benefit plan qualified.",
  },
  "/case-studies": {
    crumb: "Examples",
    title: "Cash Balance Plan Examples | Sterling Pension Group",
    description:
      "Illustrative examples of how owner-led businesses use a cash balance or defined benefit plan. These are not client results.",
  },
  "/privacy": {
    crumb: "Privacy",
    title: "Privacy Policy | Sterling Pension Group",
    description:
      "What Sterling Pension Group collects on this website, why we collect it, who we share it with, and how to ask for a correction or deletion.",
  },
  "/terms": {
    crumb: "Terms of Use",
    title: "Terms of Use | Sterling Pension Group",
    description:
      "Terms of Use for the Sterling Pension Group website, including what the site is, what it is not, and the limits on reliance before an engagement.",
  },
  "/disclaimer": {
    crumb: "Disclaimer",
    title: "Website Disclaimer | Sterling Pension Group",
    description:
      "Sterling Pension Group is not a law firm, CPA firm, or actuarial firm. Illustrations are not IRS limits, quotes, or deductible contributions.",
  },
  "/support": {
    crumb: "Client support",
    title: "Client Support | Sterling Pension Group",
    description:
      "Reach Sterling Pension Group about an existing retirement plan or a new Defined Benefit or Cash Balance administration question.",
  },
};

export const faqs = [
  {
    q: "Who typically considers these plans?",
    a: "Owners, physician practices, and consultants who want more room than a 401(k).",
  },
  {
    q: "Can I keep my 401(k)?",
    a: "Often yes. Many owners pair the two.",
  },
  {
    q: "Are contributions required every year?",
    a: "These plans are funded with discipline. Design depends on cash flow and timeline.",
  },
];
