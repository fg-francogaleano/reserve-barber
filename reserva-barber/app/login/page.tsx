import { LoginForm } from './LoginForm';
import { COPY } from '@/lib/copy';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-12">
      <h1 className="text-center text-2xl font-semibold tracking-tight">{COPY.auth.heading}</h1>
      <LoginForm next={next} />
    </main>
  );
}
