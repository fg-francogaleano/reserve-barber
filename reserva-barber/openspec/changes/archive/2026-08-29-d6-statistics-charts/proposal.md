## Why

D5 gave the owner five figures over a period they choose, and every one of them is a single number: the page can say *"this month you confirmed 42 appointments"* but not whether that was four steady weeks or one good Saturday and three quiet ones. `project-context.md` §69 asks for two charts on this page — *evolución de ingresos* and *métodos de pago* — and they are what turns a set of totals into a trend the owner can act on.

The second reason is that D5 left a figure homeless. **T83** records that the statistics page reports deposits by *appointment* (`Booking.startTime`) while the dashboard home reports them by *approval* (`Payment.approvedAt`); both are correct, they do not agree, and the owner has no surface anywhere that answers *"how much money actually arrived last week"*. T83 names D6 as its home, and this change closes it.

## What Changes

- **Two charts on `/estadisticas`**, below the existing figures and bounded by the same period the owner already selected: deposit income per time bucket, and the split between Mercado Pago and bank transfer.
- **A sixth figure card — cash collected in the period** — bounded on `Payment.approvedAt` rather than on the appointment, with copy stating that basis and that it will not equal the deposits card above it. This closes **T83**.
- **Server-rendered inline SVG, not Recharts.** The `business-statistics` spec carries a tested requirement that the page depend on no client JavaScript; a client-only charting library would remove it. Both charts are drawn by Server Components at a cost of 0 KiB of bundle.
  - **BREAKING (documentation, not runtime):** `docs/frontend-standards.md` (:58, :232, :371) and `docs/project-context.md` (:97, :99) name Recharts/Tremor for exactly these views. They are amended to record the divergence and its reason. The stack decision is not removed — it stops being a default for this page.
- **One grouped read serves both charts**, sharing a snapshot with the existing aggregate so the chart's buckets and the card above them cannot disagree on screen.
- **Bucket boundaries are computed in the domain** from `bookingCalendar` and handed to SQL as instants. `date_trunc` stays banned for the two reasons D5 recorded: its unit is an identifier position, and it truncates in the session's timezone, which is UTC in this deployment.
- **T82 is explicitly declined.** Its entry offers this page as a possible home for money the owner owes back; a chart surface is the wrong place for a refund to-do list. The entry gains a line recording that D6 looked at it and said no.

## Capabilities

### New Capabilities

None. This change extends a shipped capability rather than introducing one: same route, same period control, same tenancy join, same read port.

### Modified Capabilities

- `business-statistics`: gains requirements for the two charts, for the sixth cash-collected figure and its distinct time basis, for how income buckets are derived and filled, for the accessible non-visual equivalent of every chart, and for the degenerate and failed states each chart can be in. The existing no-client-JavaScript requirement is **reaffirmed and extended to cover the charts** rather than narrowed.

## Impact

**Code**

- `src/server/domain/models/statistics.ts` — bucket and method-share types, the series-fill rule.
- `src/server/application/dashboard/statisticsRangeParams.ts` — bucket edges and granularity per range.
- `src/server/domain/repositories/IStatisticsRepository.ts` — one new method and the rules every implementation must hold.
- `src/server/infrastructure/prisma/PrismaStatisticsRepository.ts` — the grouped statement and snapshot handling.
- `src/server/application/services/StatisticsService.ts` — an extended view, with each dataset carrying its own `Loaded<T>`.
- `app/(dashboard)/estadisticas/` — `page.tsx`, `loading.tsx`, and two new chart components.
- `src/lib/copy.ts` — chart headings, axis and method labels, empty and failed copy, T83's basis sentence.
- `scripts/d6-gate.ts`, `scripts/d6-runtime-fixture.ts` — new.

**Docs**

- `docs/frontend-standards.md`, `docs/project-context.md` — the charting decision.
- `docs/tech-debt.md` — **T83** closed; **T82** annotated; **T81**/**T47** re-measured against the new read.
- `docs/roadmap.md` — the D6 entry.

**Dependencies**

None added. This is the change that was expected to introduce a charting library and does not.

**Systems**

One additional grouped aggregate per statistics page view, against the connection pool the public booking flow shares (**T47**). No new HTTP endpoint, no Route Handler, no Server Action, and no write path — the entire surface of this change is one existing authenticated GET.
