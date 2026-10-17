# Image slots

Every image slot in the redesign, for the image-generation phase. For now each
slot holds one of the site's existing photos, cropped by CSS (`object-fit: cover`).
Hero photos sit under a navy overlay that darkens the left side, so the subject
should sit in the right third.

| # | Page | Slot | Aspect / size | Subject | Current file | Alt text today |
|---|---|---|---|---|---|---|
| 01 | `/` | Hero, behind overlay | 21:9, 2520×1080 | Owner and advisor reviewing a plan in a private office; subject right third | `/images/hero.jpg` | decorative (`""`) |
| 02 | `/` | Plan path 01 card (Defined Benefit) | 16:9, 1600×900 | Established owner reviewing long-range retirement figures | `/images/plans.jpg` | decorative |
| 03 | `/` | Plan path 02 card (Cash Balance) | 16:9, 1600×900 | Account-style balance on a tablet beside plan papers | `/images/cash.jpg` | decorative |
| 04 | `/` | Administration navy/photo split | 4:3, 1600×1200 | Back office of a small practice, team at a table | `/images/admin.jpg` | "A team meeting around a conference table" |
| 05 | `/defined-benefit` | Hero | 21:9, 2520×1080 | Office architecture / owner at desk, calm, subject right | `/images/building.jpg` | decorative |
| 06 | `/cash-balance` | Hero | 21:9, 2520×1080 | Owner looking at a balance on a laptop or tablet | `/images/cash.jpg` | decorative |
| 07 | `/combo` | Hero | 21:9, 2520×1080 | Owner and CPA comparing two plan summaries | `/images/plans.jpg` | decorative |
| 07b | `/combo` | Split photo | 4:3, 1600×1200 | Contribution comparison visual (no readable text) | `/images/plans.jpg` | "Contribution comparison visual" |
| 08 | `/self-employed` | Hero | 21:9, 2520×1080 | Self-employed professional working in a home office | `/images/plans.jpg` | decorative |
| 09 | `/physicians` | Hero; also the Physicians card on other industry pages | 21:9, 2520×1080 (card 16:9) | Physicians meeting an advisor in a clinic office | `/images/guides/physicians.jpg` | decorative (card) |
| 10 | `/dentists` | Hero; Dentists card | 21:9 (card 16:9) | Dentist speaking with an advisor in a dental practice | `/images/guides/dentists.jpg` | decorative |
| 11 | `/attorneys` | Hero; Law firms card | 21:9 (card 16:9) | Partners in a law-firm conference room | `/images/guides/attorneys.jpg` | decorative |
| 12 | `/consultants` | Hero; Consultants card | 21:9 (card 16:9) | Consultant and spouse reviewing a plan at home | `/images/guides/consultants.jpg` | decorative |
| 13 | `/services` | Hero | 21:9, 2520×1080 | Administrator's desk, census and plan binders | `/images/admin.jpg` | decorative |
| 13b | `/services` | Navy split photo | 4:3, 1600×1200 | Coordination between owner, CPA and administrator | `/images/admin.jpg` | "Illustration representing pension compliance and TPA governance" |
| 14 | `/administration` | Hero | 21:9, 2520×1080 | Small practice office, administration in progress | `/images/admin.jpg` | decorative |
| 14b | `/administration` | "Three clocks" split | 4:3, 1600×1200 | Wall calendar / deadlines in an office | `/images/building.jpg` | "Pension administration and compliance illustration" |
| 15 | `/compliance` | Hero | 21:9, 2520×1080 | Annual review meeting, checklist on table (unreadable) | `/images/building.jpg` | decorative |
| 15b | `/compliance` | Split photo | 4:3, 1600×1200 | Compliance and plan oversight | `/images/building.jpg` | "Compliance and plan oversight illustration" |
| 15c | `/compliance` | Navy split photo | 4:3, 1600×1200 | Filing season, Form 5500 work (no readable text) | `/images/admin.jpg` | decorative |
| 16 | `/staff-cost` | Hero | 21:9, 2520×1080 | Small staff meeting in a practice | `/images/guides/staff.jpg` | decorative |
| 17 | `/about` | Hero | 21:9, 2520×1080 | Sterling team (real staff photo preferred) | `/images/about.jpg` | decorative |
| 17b | `/about` | "Our role" navy split | 4:3, 1600×1200 | Owners reviewing a plan with an advisor | `/images/hero.jpg` | "Business owners reviewing a plan with an advisor" |
| 18 | `/about` | Home base split | 4:3, 1600×1200 | West Hartford office. **Use a real photo; do not generate.** | `/images/building.jpg` | decorative |
| 19 | `/contact` | Beside the info card | 4:3, 1600×1200 | Desk phone and notepad, calm office | `/images/about.jpg` | decorative |
| 20 | `/insights/[slug]`, `/insights`, `/insights/archive` | 54 post covers (article cover, cards, featured) | 16:9, 1920×1080 | One consistent still-life series: same desk, same morning light, one subject-specific object per post | `/images/briefing/YYYY-MM-DD.jpg` | article cover: post title; cards: decorative |
| 21 | all pages | Open Graph default | 1200×630 | Navy gradient, reversed badge, page title. Build from a template, not an image model. | `/og.jpg` (unchanged) | n/a |

## Post covers (slot 20)

One file per post, named by date, in `public/images/briefing/`. Posts are
2024-09-01 through 2026-09-13, every two weeks (54 files). The design's topic for
each post (`src/lib/topics.ts`) is a good prompt seed for the object on the desk.

## Notes for generation

- Pages without a hero slot use the plain navy gradient by design: calculator,
  contact, support, FAQ, the reference pages (limits, compare, illustrations,
  not-a-fit, calendar, fees, plan-lifecycle), legal pages, case studies and the
  Insights hub/archive.
- Several slots reuse one source file today (for example `admin.jpg` appears in
  five places). Generation should give each slot its own file; update the
  `src` in the page that owns the slot.
- Keep heroes under about 350 KB at full size; serve WebP/AVIF where possible.
