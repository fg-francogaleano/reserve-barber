import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { COPY } from '@/lib/copy';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';
import { formatCbu } from '@/server/domain/models/cbu';
import { hasTransferConfigured, type TransferDetails } from '@/server/domain/models/PaymentConfig';
import { paymentConfigService } from './paymentConfigService';
import { saveTransferDetailsAction } from './actions';
import { TransferDetailsForm } from './TransferDetailsForm';

// Declared here and not merely inherited from the dashboard layout: a page that
// renders a bank account must not depend on an ancestor someone edits later
// (design D11).
export const dynamic = 'force-dynamic';

const EMPTY_TRANSFER: TransferDetails = { cbuCvu: null, alias: null, holderName: null };

async function fetchTransfer(ownerId: string): Promise<TransferDetails> {
  try {
    const config = await paymentConfigService().getConfig(ownerId);
    return config?.transfer ?? EMPTY_TRANSFER;
  } catch (error) {
    logger.error('Failed to load transferencia page data', toErrorLogContext('getConfig', error));
    throw error;
  }
}

export default async function TransferPage() {
  const owner = await requireOwner();
  const transfer = await fetchTransfer(owner.id);
  const configured = hasTransferConfigured(transfer);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{COPY.transfer.heading}</h1>
        <p className="text-muted-foreground text-sm">{COPY.transfer.intro}</p>
      </div>

      {/*
        The stored values, read from the database rather than echoed from form
        state (design D3). This panel is the owner's only real defence against a
        mistyped destination: a screen showing what they typed cannot reveal a
        value that failed to store, and 22 unbroken digits cannot be checked by
        eye — hence the grouping.
      */}
      <Card>
        <CardHeader>
          <CardTitle>{COPY.transfer.currentHeading}</CardTitle>
        </CardHeader>
        <CardContent>
          {configured ? (
            <dl className="flex flex-col gap-3 text-sm">
              <div className="flex flex-col">
                <dt className="text-muted-foreground text-xs">{COPY.transfer.confirmCbuLabel}</dt>
                <dd className="font-mono">
                  {transfer.cbuCvu ? formatCbu(transfer.cbuCvu) : COPY.transfer.confirmNone}
                </dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-muted-foreground text-xs">{COPY.transfer.confirmAliasLabel}</dt>
                <dd className="font-mono">{transfer.alias ?? COPY.transfer.confirmNone}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-muted-foreground text-xs">{COPY.transfer.confirmHolderLabel}</dt>
                <dd>{transfer.holderName ?? COPY.transfer.confirmNone}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-muted-foreground text-sm">{COPY.transfer.emptyState}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{COPY.transfer.formHeading}</CardTitle>
        </CardHeader>
        <CardContent>
          <TransferDetailsForm
            action={saveTransferDetailsAction}
            defaults={{
              // Formatted on the SERVER so the first client render matches:
              // formatting in an effect would produce a hydration mismatch on
              // exactly the screen where the owner is checking digits by eye.
              cbuCvu: transfer.cbuCvu ? formatCbu(transfer.cbuCvu) : '',
              alias: transfer.alias ?? '',
              holderName: transfer.holderName ?? '',
            }}
          />
        </CardContent>
      </Card>
    </main>
  );
}
