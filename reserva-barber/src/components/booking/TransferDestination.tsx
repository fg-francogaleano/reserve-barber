import { COPY } from '@/lib/copy';
import { formatCurrency } from '@/lib/formatCurrency';
import type { PublicTransferDestination } from '@/server/domain/repositories/IBookingRepository';
import { CopyValueButton } from './CopyValueButton';

/**
 * The account to transfer to, the exact amount, and the deadline.
 *
 * **A server component, rendering values it is handed.** It cannot fetch a
 * destination and is never given one unless the booking has already committed
 * to transfer — the projection that feeds it is null otherwise, so the rule
 * "a CBU is never visible during a window about to lapse" is enforced before
 * this file, not inside it.
 *
 * **The warning is above the account number, in document order.** After the
 * client has read a CBU is too late: there is no gateway on this path, so a
 * transfer made past the deadline moves real money that no row here records
 * and nothing can be asked about. Reading it first is the only protection.
 */
export function TransferDestination({
  destination,
  depositAmount,
  minutesLeft,
}: {
  destination: PublicTransferDestination;
  depositAmount: string;
  /** Whole minutes, computed on the server. Null when there is no deadline. */
  minutesLeft: number | null;
}) {
  return (
    <section className="border-border flex flex-col gap-4 rounded-md border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-medium">{COPY.booking.transferDestinationHeading}</h2>
        {minutesLeft !== null && (
          <p className="text-sm font-medium" role="alert">
            {COPY.booking.transferDeadlineWarning(minutesLeft)}
          </p>
        )}
      </div>

      <dl className="flex flex-col gap-3">
        {/* The amount first: it is the value a client is most likely to get
            wrong, and the one nothing downstream can correct. */}
        <Field label={COPY.booking.transferAmountLabel} value={formatCurrency(depositAmount)} />

        {destination.cbuCvu !== null && (
          <Field label={COPY.booking.transferCbuLabel} value={destination.cbuCvu} copyable />
        )}
        {destination.alias !== null && (
          <Field label={COPY.booking.transferAliasLabel} value={destination.alias} copyable />
        )}
        {/* Required for a destination to be offered at all: without it the
            client cannot confirm from their bank's screen who they are paying. */}
        <Field label={COPY.booking.transferHolderLabel} value={destination.holderName} />
      </dl>
    </section>
  );
}

/**
 * One labelled value.
 *
 * `break-all` rather than `break-words` on the value: a 22-digit CBU is one
 * unbroken token and would otherwise overflow a 360-pixel viewport, which is
 * the case this flow is actually used on.
 *
 * The copy control is **progressive enhancement over selectable text**. The
 * value is always present and always selectable, so a client with JavaScript
 * off can still read and copy it by hand.
 */
function Field({
  label,
  value,
  copyable = false,
}: {
  label: string;
  value: string;
  copyable?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="flex items-center gap-2">
        <span className="font-mono text-base break-all select-all">{value}</span>
        {copyable && <CopyValueButton value={value} label={label} />}
      </dd>
    </div>
  );
}
