import { COPY } from '@/lib/copy';
import { formatCurrency } from '@/lib/formatCurrency';
import type { PaymentMethodShare } from '@/server/domain/models/statistics';
import { sharesFor } from './chartGeometry';

/**
 * How the period's deposits split between the two payment rails (D6).
 *
 * **A stacked bar rather than a pie**, and the reason is legibility: two
 * proportions are read more accurately from lengths than from angles, and a bar
 * degrades to a single labelled block when only one method was used. See
 * `chartGeometry.ts` for the geometry and for why no charting library is
 * involved.
 *
 * **Colour is never the only thing distinguishing the two parts.** Each carries
 * its name, its formatted amount and its payment count as text beside the bar —
 * so the chart survives greyscale, colour blindness, and a screen reader, and
 * the legend is the content rather than a key to it.
 *
 * **Amount is the encoding, count is beside it.** Either alone describes the
 * shop wrongly: three small transfers against one large Mercado Pago payment is
 * a different fact depending on whether the owner is thinking about fees or
 * about clients, and the page should not choose for them.
 *
 * **A single method is stated, not drawn.** A share of one part is not
 * information, and it is the permanent state of every owner who configured only
 * one payment method — so that case gets a sentence instead of a full-width bar
 * implying a comparison that does not exist.
 */

/**
 * One fill per rail, from the design tokens rather than from literals.
 *
 * Two hues that stay distinguishable in both themes; the text labels below are
 * what carry the meaning regardless.
 */
const FILLS: Record<PaymentMethodShare['method'], string> = {
  MERCADO_PAGO: 'fill-primary',
  BANK_TRANSFER: 'fill-muted-foreground',
};

const SWATCHES: Record<PaymentMethodShare['method'], string> = {
  MERCADO_PAGO: 'bg-primary',
  BANK_TRANSFER: 'bg-muted-foreground',
};

export function PaymentMethodsChart({ split }: { split: readonly PaymentMethodShare[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-medium">{COPY.statistics.methodsChartHeading}</h2>
      <p className="text-muted-foreground text-sm">{COPY.statistics.methodsChartHelp}</p>

      <Split split={split} />
    </section>
  );
}

function Split({ split }: { split: readonly PaymentMethodShare[] }) {
  // Nothing was collected. Not a failure and not a zero-width bar — a sentence,
  // because an empty proportion is the absence of an answer rather than one.
  if (split.length === 0) {
    return <p className="text-muted-foreground text-sm">{COPY.statistics.methodsChartEmpty}</p>;
  }

  const only = split.length === 1 ? split[0] : undefined;
  if (only !== undefined) {
    return (
      <p className="text-sm">
        {COPY.statistics.methodsChartSingle(
          COPY.statistics.methods[only.method],
          formatCurrency(only.total),
          COPY.statistics.methodPaymentCount(only.payments)
        )}
      </p>
    );
  }

  const shares = sharesFor(split);

  return (
    <div className="flex flex-col gap-3">
      <svg
        viewBox="0 0 100 8"
        preserveAspectRatio="none"
        className="h-4 w-full"
        role="img"
        aria-label={COPY.statistics.methodsChartLabel}
      >
        {shares.map((share) => (
          <rect
            key={share.method}
            x={share.offset * 100}
            y={0}
            width={share.fraction * 100}
            height={8}
            className={FILLS[share.method]}
          >
            <title>{`${COPY.statistics.methods[share.method]}: ${formatCurrency(share.share.total)}`}</title>
          </rect>
        ))}
      </svg>

      {/*
        The legend *is* the accessible equivalent here — a real table would
        repeat four cells that already read as a list. Each row carries the
        swatch, the name, the amount and the count, so nothing depends on the
        colours above resolving.
      */}
      <dl className="flex flex-col gap-1 text-sm">
        {split.map((part) => (
          <div key={part.method} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`inline-block size-3 shrink-0 rounded-xs ${SWATCHES[part.method]}`}
            />
            <dt className="min-w-0">{COPY.statistics.methods[part.method]}</dt>
            <dd className="ml-auto flex items-baseline gap-2">
              <span className="font-medium">{formatCurrency(part.total)}</span>
              <span className="text-muted-foreground text-xs">
                {COPY.statistics.methodPaymentCount(part.payments)}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
