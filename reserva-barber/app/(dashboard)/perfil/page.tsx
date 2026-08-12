import { headers } from 'next/headers';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { COPY } from '@/lib/copy';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';
import { resolveOrigin } from '@/server/application/businessProfile/resolveOrigin';
import { publicProfileUrl, type BusinessProfile } from '@/server/domain/models/BusinessProfile';
import { profileService } from './profileService';
import { saveBusinessProfileAction } from './actions';
import { ProfileForm } from './ProfileForm';
import { ShareableLink } from './ShareableLink';

export const dynamic = 'force-dynamic';

async function fetchProfile(ownerId: string): Promise<BusinessProfile | null> {
  try {
    const service = await profileService();
    return await service.findProfile(ownerId);
  } catch (error) {
    logger.error('Failed to load perfil page data', toErrorLogContext('findProfile', error));
    throw error;
  }
}

/**
 * The origin is read from the request, on the server.
 *
 * Never from `window.location`: it is undefined during server rendering and
 * causes a hydration mismatch when a client component reaches for it on first
 * paint (design D11).
 */
async function currentOrigin(): Promise<string | null> {
  const requestHeaders = await headers();

  return resolveOrigin({
    configured: process.env.APP_ORIGIN,
    host: requestHeaders.get('host') ?? undefined,
    forwardedProto: requestHeaders.get('x-forwarded-proto') ?? undefined,
  });
}

export default async function ProfilePage() {
  const owner = await requireOwner();
  const [profile, origin] = await Promise.all([fetchProfile(owner.id), currentOrigin()]);

  const shareableLink =
    profile !== null && origin !== null ? publicProfileUrl(origin, profile.publicSlug) : null;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{COPY.businessProfile.heading}</h1>
        <p className="text-muted-foreground text-sm">{COPY.businessProfile.intro}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{COPY.businessProfile.linkHeading}</CardTitle>
        </CardHeader>
        <CardContent>
          {shareableLink === null ? (
            <p className="text-muted-foreground text-sm">{COPY.businessProfile.linkBeforeSave}</p>
          ) : (
            <ShareableLink url={shareableLink} />
          )}
        </CardContent>
      </Card>

      <ProfileForm
        action={saveBusinessProfileAction}
        defaults={{
          businessName: profile?.businessName ?? '',
          bio: profile?.bio ?? '',
          publicSlug: profile?.publicSlug ?? '',
          photoUrl: profile?.photoUrl ?? null,
          coverUrl: profile?.coverUrl ?? null,
          socialLinks:
            profile?.socialLinks.map((link) => ({ platform: link.platform, url: link.url })) ?? [],
        }}
      />
    </main>
  );
}
