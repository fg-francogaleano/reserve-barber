import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { COPY } from '@/lib/copy';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';
import { formatDateTime } from '@/lib/formatDate';
import type { MercadoPagoView } from '@/server/domain/models/PaymentConfig';
import { mercadoPagoConfigService } from './paymentConfigService';
import { saveMercadoPagoCredentialsAction } from './actions';
import { MercadoPagoCredentialsForm } from './MercadoPagoCredentialsForm';

// Declared here and not merely inherited from the dashboard layout: a page that
// renders payment configuration must not depend on an ancestor someone edits
// later (design D11 of PC1, inherited).
export const dynamic = 'force-dynamic';

const EMPTY_VIEW: MercadoPagoView = {
  configured: false,
  publicKey: null,
  environment: null,
  lastFour: null,
  changedAt: null,
  unreadable: false,
};

async function fetchView(ownerId: string): Promise<MercadoPagoView> {
  try {
    return await mercadoPagoConfigService().getMercadoPagoView(ownerId);
  } catch (error) {
    logger.error('Failed to load mercado-pago page data', toErrorLogContext('getMercadoPagoView', error));
    throw error;
  }
}

export default async function MercadoPagoPage() {
  const owner = await requireOwner();
  const view = await fetchView(owner.id).catch(() => EMPTY_VIEW);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{COPY.mercadoPago.heading}</h1>
        <p className="text-muted-foreground text-sm">{COPY.mercadoPago.intro}</p>
      </div>

      {/*
        Design D8. Persistent and not dismissible, because the owner it protects
        is one who stopped noticing months ago and is now taking real bookings
        that will never be charged.
      */}
      {view.environment === 'test' ? (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive rounded-lg border p-3 text-sm font-medium"
        >
          {COPY.mercadoPago.testCredentialsBanner}
        </p>
      ) : null}

      {/*
        Four states, not three (design D12). Without the unreadable one, a
        missing or corrupt key renders a perfectly healthy "configured" panel
        over a token nobody can read, and the failure surfaces for the first
        time in a real client's checkout.
      */}
      <Card>
        <CardHeader>
          <CardTitle>{COPY.mercadoPago.currentHeading}</CardTitle>
        </CardHeader>
        <CardContent>
          {view.unreadable ? (
            <div className="flex flex-col gap-2">
              <p className="text-destructive text-sm font-semibold">
                {COPY.mercadoPago.unreadableHeading}
              </p>
              <p className="text-muted-foreground text-sm">{COPY.mercadoPago.unreadable}</p>
            </div>
          ) : view.configured ? (
            <dl className="flex flex-col gap-3 text-sm">
              {/*
                Two claims were tried here and both were withdrawn, for the same
                reason: the page must not assert what it cannot verify.

                First "Entorno: Producción", inferred from the `APP_USR-` prefix
                — which the credentials panel issues for test and production
                alike, so it was printing "Producción" over test credentials.

                Then the Mercado Pago account, read off the token's trailing
                segment — which turned out not to be the account either: the
                segment read 1325562541 while the owner's User ID is 156842883.

                What is left is what is true: four characters of the token, the
                public key, and when it last changed. The account identity now
                appears only on the confirmation, and only when Mercado Pago
                itself supplied it.
              */}
              {/* Only when the credential says so outright. */}
              {view.environment === 'test' ? (
                <div className="flex flex-col">
                  <dt className="text-muted-foreground text-xs">
                    {COPY.mercadoPago.environmentLabel}
                  </dt>
                  <dd>{COPY.mercadoPago.environmentTest}</dd>
                </div>
              ) : null}
              {/*
                The token is never shown. These two are what let the owner tell
                a completed rotation from an uncertain one after a save whose
                outcome was unknown.
              */}
              <div className="flex flex-col">
                <dt className="text-muted-foreground text-xs">{COPY.mercadoPago.lastFourLabel}</dt>
                <dd className="font-mono">···{view.lastFour ?? COPY.mercadoPago.none}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-muted-foreground text-xs">{COPY.mercadoPago.publicKeyLabel}</dt>
                <dd className="font-mono break-all">
                  {view.publicKey ?? COPY.mercadoPago.none}
                </dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-muted-foreground text-xs">{COPY.mercadoPago.changedAtLabel}</dt>
                <dd>{view.changedAt ? formatDateTime(view.changedAt) : COPY.mercadoPago.none}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-muted-foreground text-sm">{COPY.mercadoPago.emptyState}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{COPY.mercadoPago.formHeading}</CardTitle>
        </CardHeader>
        <CardContent>
          <MercadoPagoCredentialsForm
            action={saveMercadoPagoCredentialsAction}
            defaults={{ publicKey: view.publicKey ?? '' }}
            configured={view.configured}
          />
        </CardContent>
      </Card>
    </main>
  );
}
