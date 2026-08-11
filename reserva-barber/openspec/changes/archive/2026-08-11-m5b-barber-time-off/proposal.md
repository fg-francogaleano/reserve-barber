## Why

M5a records when a barber works. Nothing yet records when they are away, so a barber on holiday is still fully bookable and the recurring schedule is the only thing slot generation can consult. B3 needs both halves; this is the second.

It also closes Phase 1a. Every catalogue and configuration story the owner needs before the public booking flow will be done.

The entity is the one place in the data model where "a date" and "an instant" have been used interchangeably: §9 currently says `startDate`/`endDate` are "date/datetime", which are different types with different edge behaviour. M5a settled the project's stored-time convention; this change is where `TimeOff` has to obey it.

## What Changes

- Add the `TimeOff` model and migration: UTC instants in `timestamptz`, per the convention M5a recorded.
- Add an absences editor at `/barberos/[id]/ausencias`: a list of the barber's recorded absences with a form to add one and a control to remove one.
- **Whole days and partial days use one representation, not two.** An absence is a half-open instant range `[startsAt, endsAt)`. A full day off is `[00:00 local, 00:00 next-day local)`. There is no "all day" flag — a flag would be a second way to say the same thing, and two representations of one fact can disagree.
- The form asks for a start date and an end date, with **optional** times. Leaving both times empty means whole days, and the end date is then read **inclusively** — "vacaciones del 1 al 15" includes the 15th. That inclusive-day-to-exclusive-instant conversion happens in exactly one place and is tested, because it is precisely the kind of translation that silently loses a day.
- `reason` is optional free text that **must never leave the dashboard**: not into the log stream, not into any public projection. It can hold medical information.
- Absences may overlap each other. They union naturally and validating against it would be friction with no benefit.
- The barbers list gains nothing; the absences editor is reached from the same place as the schedule editor.

## Capabilities

### New Capabilities
- `barber-time-off`: the owner records and removes a barber's absences — the editor, the half-open instant range, the whole-day conversion, the bounds on how long and how far out an absence may run, the privacy rule on `reason`, and the Spanish (es-AR) states of the form and list.

### Modified Capabilities
- `data-persistence`: the `TimeOff` model as single source of truth, its zone-aware columns, the unique key that makes a retried create idempotent, and the owner-scoped queries behind the list and the delete.

## Impact

**Schema** — new `TimeOff` model and migration `add_time_off`; back-relation on `Barber`; both Prisma clients regenerated. Purely additive.

**Server layers** — new `ITimeOffRepository`, `PrismaTimeOffRepository`, `BarberTimeOffService`, `timeOffSchema`, and `TimeOffErrors`. `businessTime` from M5a is consumed as-is; this change adds no conversion logic of its own beyond the whole-day boundary.

**Presentation** — new route group `app/(dashboard)/barberos/[id]/ausencias/`; modifications to `app/(dashboard)/barberos/page.tsx` (a route into the editor) and `src/lib/copy.ts`; a new date formatter.

**Runtime risk** — low. The one genuinely new thing on this stack is `@db.Timestamptz`, which no table uses yet; a round-trip check confirms an instant survives storage without drifting. The timezone conversion itself was gated in M5a.

**Downstream** — completes B3's inputs. Nothing else depends on it.

**Not affected** — working hours, business holidays (still a separate entity that does not exist), the public flow.
