import Link from 'next/link';
import { notFound } from 'next/navigation';
import { COPY } from '@/lib/copy';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';
import { BarberServicesForm, type AssignableService } from './BarberServicesForm';
import { setBarberServicesAction } from './actions';
import { assignmentService } from './assignmentService';

export const dynamic = 'force-dynamic';

export default async function BarberServicesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const owner = await requireOwner();
  const { id } = await params;

  let data;
  try {
    data = await assignmentService().getEditorData(owner.id, id);
  } catch (error) {
    logger.error(
      'Failed to load barber services editor',
      toErrorLogContext('getAssignmentEditorData', error)
    );
    throw error;
  }

  // Unknown id and another owner's id are the same answer: a 403 would confirm
  // the id exists and turn this route into an enumeration oracle.
  if (data === null) {
    notFound();
  }

  const services: AssignableService[] = data.assignable.map((service) => ({
    id: service.id,
    name: service.name,
    isActive: service.isActive,
  }));

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight break-words">
        {COPY.barberServices.heading(data.barber.displayName)}
      </h1>

      {services.length === 0 ? (
        // No catalogue means no operable form — a submit button over zero
        // options is a control that can only do nothing.
        <>
          <p className="text-muted-foreground">{COPY.barberServices.emptyNoServices}</p>
          <Link
            href="/servicios/nuevo"
            className="text-primary text-sm font-medium underline-offset-4 hover:underline"
          >
            {COPY.barberServices.createService}
          </Link>
        </>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">{COPY.barberServices.intro}</p>
          <BarberServicesForm
            action={setBarberServicesAction}
            barberId={data.barber.id}
            services={services}
            assignedIds={data.assignedIds}
          />
        </>
      )}
    </main>
  );
}
