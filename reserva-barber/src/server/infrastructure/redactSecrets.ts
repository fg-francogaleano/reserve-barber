import type { ErrorLogContext } from '@/server/infrastructure/errorLogContext';

const REDACTED = '[redacted]';

/**
 * Removes submitted secrets from a log context.
 *
 * `toErrorLogContext` already strips the message of the Prisma codes whose text
 * is known to embed column values. It deliberately KEEPS the message of an
 * unrecognized error, because a failure stripped of its detail cannot be
 * diagnosed (M3 design D11) — and that exception is exactly what would let a
 * bank account or a bearer token reach the log stream.
 *
 * Redacting rather than dropping the cause keeps both guarantees: the operator
 * still sees what failed, and the secret never appears.
 *
 * Generalized from PC1's `redactDestination` when PC2 needed the same guard for
 * Mercado Pago credentials — including the error bodies Mercado Pago itself
 * returns, which routinely echo the credential they rejected. Two call sites is
 * where a copied helper starts to drift.
 *
 * Only values long enough to be a real secret are matched, so a short or empty
 * field cannot blank out an entire message.
 */
const MIN_REDACTABLE_LENGTH = 4;

export function redactSecrets(
  context: ErrorLogContext,
  secrets: readonly (string | null | undefined)[]
): ErrorLogContext {
  if (context.cause === undefined) {
    return context;
  }

  let cause = context.cause;
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= MIN_REDACTABLE_LENGTH) {
      cause = cause.split(secret).join(REDACTED);
    }
  }

  return { ...context, cause };
}
