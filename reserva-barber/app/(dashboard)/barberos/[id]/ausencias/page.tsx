import { notFound } from 'next/navigation';
import { COPY } from '@/lib/copy';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';
import { formatTimeOffRange } from '@/lib/formatDate';
import { Button } from '@/components/ui/button';
import { TimeOffForm } from './TimeOffForm';
import { recordAbsenceAction, removeAbsenceAction } from './actions';
import { timeOffService } from './timeOffService';

export const dynamic = 'force-dynamic';

export default async function TimeOffPage({ params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner();
  const { id } = await params;

  let data;
  try {
    data = await timeOffService().getEditorData(owner.id, id);
  } catch (error) {
    logger.error('Failed to load time off editor', toErrorLogContext('getTimeOffEditorData', error));
    throw error;
  }

  // Unknown id and another owner's id are the same answer: a distinguishable
  // response would confirm the id exists.
  if (data === null) {
    notFound();
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight break-words">
        {COPY.timeOff.heading(data.barber.displayName)}
      </h1>
      <p className="text-muted-foreground text-sm">{COPY.timeOff.intro}</p>

      <TimeOffForm action={recordAbsenceAction} barberId={data.barber.id} />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">{COPY.timeOff.listHeading}</h2>
        {data.absences.length === 0 ? (
          <p className="text-muted-foreground text-sm">{COPY.timeOff.empty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.absences.map((absence) => {
              // Rendered on the server: formatting the same instant in a Client
              // Component invites a hydration mismatch, since the build's
              // locale data and the browser's need not agree.
              const range = formatTimeOffRange(absence.startsAt, absence.endsAt);
              return (
                <li
                  key={absence.id}
                  className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="text-sm font-medium break-words">{range}</span>
                    {absence.reason ? (
                      <span className="text-muted-foreground text-xs break-words">
                        {absence.reason}
                      </span>
                    ) : null}
                  </div>
                  {/* No confirmation dialog: the action is cheap to reverse by
                      re-adding, and a dialog on a cheap action trains people to
                      dismiss dialogs. */}
                  <form action={removeAbsenceAction}>
                    <input type="hidden" name="timeOffId" value={absence.id} />
                    <input type="hidden" name="barberId" value={data.barber.id} />
                    <Button type="submit" variant="outline" aria-label={COPY.timeOff.removeLabel(range)}>
                      {COPY.timeOff.remove}
                    </Button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
