import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { COPY } from '@/lib/copy';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';
import {
  hasDepositConfigured,
  type DepositPolicySettings,
  type PaymentReadiness,
} from '@/server/domain/models/PaymentConfig';
import { depositPolicyService } from './paymentConfigService';
import { saveDepositPolicyAction, removeDepositPolicyAction } from './actions';
import { DepositPolicyForm } from './DepositPolicyForm';
import { describePolicy, displayPercent } from './formState';

// Declared here and not merely inherited from the dashboard layout: a page that
// decides what every client is charged must not depend on an ancestor someone
// edits later.
export const dynamic = 'force-dynamic';

async function fetchPageData(
  ownerId: string
): Promise<{ policy: DepositPolicySettings; readiness: PaymentReadiness }> {
  try {
    const service = depositPolicyService();
    // Two reads of the same row rather than one shared call: the page is not
    // hot, and the alternative is a bespoke method that exists only to save a
    // query on a settings screen.
    const [policy, readiness] = await Promise.all([
      service.getDepositPolicy(ownerId),
      service.getPaymentReadiness(ownerId),
    ]);
    return { policy, readiness };
  } catch (error) {
    logger.error('Failed to load sena page data', toErrorLogContext('getDepositPolicy', error));
    throw error;
  }
}

/**
 * The one place that answers "can my business take bookings?".
 *
 * Never conveys state by colour alone: each line carries its own words, so the
 * answer survives a screen reader and a monochrome display.
 */
function ReadinessPanel({ readiness }: { readiness: PaymentReadiness }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{COPY.deposit.readinessHeading}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <p className="font-medium">
          {readiness.ready ? COPY.deposit.readinessReady : COPY.deposit.readinessNotReady}
        </p>
        <ul className="text-muted-foreground flex flex-col gap-1">
          <li>
            {readiness.hasPaymentMethod
              ? COPY.deposit.readinessHasPaymentMethod
              : COPY.deposit.readinessMissingPaymentMethod}
          </li>
          <li>
            {readiness.hasDepositPolicy
              ? COPY.deposit.readinessHasDeposit
              : COPY.deposit.readinessMissingDeposit}
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}

export default async function DepositPage() {
  const owner = await requireOwner();
  const { policy, readiness } = await fetchPageData(owner.id);
  const configured = hasDepositConfigured(policy);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{COPY.deposit.heading}</h1>
        <p className="text-muted-foreground text-sm">{COPY.deposit.intro}</p>
      </div>

      <ReadinessPanel readiness={readiness} />

      {/*
        The stored policy, read from the database rather than echoed from form
        state. A screen showing what the owner typed cannot reveal a value that
        failed to store.
      */}
      <Card>
        <CardHeader>
          <CardTitle>{COPY.deposit.currentHeading}</CardTitle>
        </CardHeader>
        <CardContent>
          {configured ? (
            <div className="flex flex-col gap-2 text-sm">
              <p className="font-mono text-lg">{describePolicy(policy.type, policy.value)}</p>
              {policy.type === 'PERCENT' && Number(policy.value) === 100 ? (
                <p>{COPY.deposit.fullPrepaymentNotice}</p>
              ) : null}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">{COPY.deposit.emptyState}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{COPY.deposit.formHeading}</CardTitle>
        </CardHeader>
        <CardContent>
          <DepositPolicyForm
            action={saveDepositPolicyAction}
            removeAction={removeDepositPolicyAction}
            defaults={{
              // The type always has a value, so the selector always has a
              // selection — but the VALUE is blank when unconfigured, because
              // prefilling it would present a policy the owner never chose.
              type: policy.type,
              // Percentages are stored as `30.00` and shown as `30`: the
              // trailing decimals are an artefact of the column, not something
              // the owner typed or should have to delete.
              value:
                policy.value === null
                  ? ''
                  : policy.type === 'PERCENT'
                    ? displayPercent(policy.value)
                    : policy.value,
            }}
            configured={configured}
          />
        </CardContent>
      </Card>
    </main>
  );
}
