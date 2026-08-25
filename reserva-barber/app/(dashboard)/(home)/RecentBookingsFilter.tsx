import { COPY } from '@/lib/copy';
import { RECENT_FILTER_PARAM } from '@/server/application/dashboard/recentBookingsParams';
import type { FilterableBarber } from '@/server/domain/models/dashboardSummary';

/**
 * The barber filter: a GET form with a native `<select>`.
 *
 * **No `'use client'`, no Server Action, and that is the design rather than an
 * omission.** `frontend-standards.md` supplies both halves. A Radix `Select`
 * renders a button and a portalled listbox — it is not a form-associated
 * control, so without a hidden mirror input it submits nothing. And the house
 * form pattern's `useActionState` is what T44 is about: ten dashboard forms
 * that accept a submission without JavaScript and report nothing back.
 *
 * A GET form needs neither. It navigates and the server re-renders from the
 * URL, so this control has nothing to hydrate and adds no client JavaScript to
 * a page that ships none.
 *
 * **It still does not work with JavaScript disabled, and the reason is not this
 * component.** That was claimed during D1 and measured false: the page sits
 * inside a segment with a `loading.tsx`, which makes Next stream it — the
 * fallback arrives first and the real markup is swapped in by inline scripts
 * that never run with JavaScript off, so the skeleton never resolves and this
 * form is never reached. Removing the boundary here would not change it, since
 * the route would simply inherit the dashboard group's, which has covered `/`
 * since A1. Recorded as a widening of T44's Cause 1: it defeats a page of pure
 * Server Components, not only the client ones that entry measured.
 *
 * Keeping the state in the URL is what makes back, forward, reload and a
 * bookmarked filter all reproduce the same view, the same convention the
 * public booking flow follows for its own steps.
 */
export function RecentBookingsFilter({
  barbers,
  selectedBarberId,
}: {
  barbers: readonly FilterableBarber[];
  selectedBarberId: string | undefined;
}) {
  // A shop with no barbers has nothing to filter by. An empty select is a
  // control that cannot do anything.
  if (barbers.length === 0) return null;

  return (
    <form method="get" className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="barber-filter" className="text-muted-foreground text-sm font-medium">
          {COPY.dashboard.filterLabel}
        </label>
        {/*
          Styled with the same ring and border tokens as `Input`, so a native
          control does not read as an unstyled escape hatch.
        */}
        <select
          id="barber-filter"
          name={RECENT_FILTER_PARAM}
          defaultValue={selectedBarberId ?? ''}
          className="border-input bg-background ring-offset-background focus-visible:ring-ring h-10 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <option value="">{COPY.dashboard.filterAll}</option>
          {barbers.map((barber) => (
            <option key={barber.id} value={barber.id}>
              {barber.displayName}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        className="bg-primary text-primary-foreground hover:bg-primary/90 h-10 rounded-md px-4 text-sm font-medium transition-colors"
      >
        {COPY.dashboard.filterSubmit}
      </button>
    </form>
  );
}
