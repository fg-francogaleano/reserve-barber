import { notFound } from 'next/navigation';
import { COPY } from '@/lib/copy';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';
import { formatMinuteOfDay } from '@/lib/formatTime';
import { WeeklyScheduleForm } from './WeeklyScheduleForm';
import { setWorkingHoursAction } from './actions';
import { scheduleService } from './scheduleService';
import { emptyWeek, type WeekValues } from './formState';

export const dynamic = 'force-dynamic';

export default async function WorkingHoursPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const owner = await requireOwner();
  const { id } = await params;

  let data;
  try {
    data = await scheduleService().getEditorData(owner.id, id);
  } catch (error) {
    logger.error('Failed to load working hours editor', toErrorLogContext('getScheduleEditorData', error));
    throw error;
  }

  // Unknown id and another owner's id are the same answer: a 403 would confirm
  // the id exists and turn this route into an enumeration oracle.
  if (data === null) {
    notFound();
  }

  const values: WeekValues = emptyWeek();
  for (const window of data.windows) {
    values[String(window.dayOfWeek)] = {
      start: formatMinuteOfDay(window.startMinute),
      end: formatMinuteOfDay(window.endMinute),
    };
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight break-words">
        {COPY.workingHours.heading(data.barber.displayName)}
      </h1>
      <p className="text-muted-foreground text-sm">{COPY.workingHours.intro}</p>
      <WeeklyScheduleForm
        action={setWorkingHoursAction}
        barberId={data.barber.id}
        defaultValues={values}
      />
    </main>
  );
}
