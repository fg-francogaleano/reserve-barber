import { COPY } from '@/lib/copy';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import { ServiceForm } from '../ServiceForm';
import { createServiceAction } from '../actions';

export const dynamic = 'force-dynamic';

/**
 * Unlike `/barberos/nuevo`, this page has no upstream prerequisite: a service
 * needs neither a location nor a barber to exist, so there is no "create
 * something else first" state to branch on.
 */
export default async function NewServicePage() {
  await requireOwner();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">{COPY.services.form.createHeading}</h1>
      <ServiceForm action={createServiceAction} />
    </main>
  );
}
