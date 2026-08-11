import Link from 'next/link';
import { COPY } from '@/lib/copy';

export default function TimeOffNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <p className="text-lg">{COPY.timeOff.barberNotFound}</p>
      <Link href="/barberos" className="text-primary text-sm font-medium underline-offset-4 hover:underline">
        {COPY.barbers.heading}
      </Link>
    </main>
  );
}
