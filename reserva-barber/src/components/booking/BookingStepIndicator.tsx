import { COPY } from '@/lib/copy';
import type { BookingStep } from '@/server/application/booking/bookingSelectionParams';

interface BookingStepIndicatorProps {
  current: BookingStep;
  /** False when the shop has a single branch, so the skipped step is not counted. */
  hasBranchChoice: boolean;
}

const LABELS = {
  location: COPY.booking.steps.location,
  service: COPY.booking.steps.service,
  barber: COPY.booking.steps.barber,
  date: COPY.booking.steps.date,
  slot: COPY.booking.steps.slot,
} as const;

/**
 * The flow in order, in one place.
 *
 * The count is derived from this rather than written as a number anywhere: B3
 * took the flow from three steps to five, and every literal "3" would have been
 * a separate thing to remember. The single-branch skip then removes one member
 * instead of needing a second rule.
 */
const FLOW = [
  'location',
  'service',
  'barber',
  'date',
  'slot',
] as const satisfies readonly (keyof typeof LABELS)[];

/**
 * Where the client is in the flow.
 *
 * `aria-current="step"` rather than styling alone: a colour change is invisible
 * to a screen reader and to anyone who cannot distinguish the two colours, and
 * this is the only thing on the page that says how much is left.
 *
 * The branch step disappears from the count entirely when the shop has one
 * (design D13). Showing "paso 2 de 3" on what is visibly the first screen would
 * describe a step the client never saw and cannot go back to.
 */
export function BookingStepIndicator({ current, hasBranchChoice }: BookingStepIndicatorProps) {
  const steps: (keyof typeof LABELS)[] = hasBranchChoice
    ? [...FLOW]
    : FLOW.filter((step) => step !== 'location');

  // `complete` sits past the last step; the final step stays marked so the
  // indicator never reads as being nowhere.
  const activeIndex = current === 'complete' ? steps.length - 1 : steps.indexOf(current);

  return (
    <nav aria-label={COPY.booking.heading} className="w-full">
      <ol className="text-muted-foreground flex items-center justify-center gap-2 text-sm">
        {steps.map((step, index) => {
          const isCurrent = index === activeIndex;
          const isDone = index < activeIndex;

          return (
            <li key={step} className="flex items-center gap-2">
              <span
                {...(isCurrent && { 'aria-current': 'step' })}
                className={
                  isCurrent
                    ? 'text-foreground font-medium'
                    : isDone
                      ? 'text-foreground/70'
                      : undefined
                }
              >
                {LABELS[step]}
              </span>
              {index < steps.length - 1 && <span aria-hidden="true">›</span>}
            </li>
          );
        })}
      </ol>
      <p className="sr-only">{COPY.booking.stepPosition(activeIndex + 1, steps.length)}</p>
    </nav>
  );
}
