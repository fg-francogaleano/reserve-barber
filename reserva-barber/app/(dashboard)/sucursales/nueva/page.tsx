import { COPY } from '@/lib/copy';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import { LocationForm } from '../LocationForm';
import { createLocationAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function NewLocationPage() {
  await requireOwner();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">{COPY.locations.form.createHeading}</h1>
      <LocationForm action={createLocationAction} />
    </main>
  );
}
