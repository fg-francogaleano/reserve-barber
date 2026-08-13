import type { ErrorLogContext } from '@/server/infrastructure/errorLogContext';

const REDACTED = '[redacted]';

/**
 * Removes a submitted transfer destination from a log context (design D9).
 *
 * `toErrorLogContext` already strips the message of the Prisma codes whose text
 * is known to embed column values. It deliberately KEEPS the message of an
 * unrecognized error, because a failure stripped of its detail cannot be
 * diagnosed (M3 design D11) — and that exception is what would let a bank
 * account reach the log stream here.
 *
 * Redacting rather than dropping the cause keeps both guarantees: the operator
 * still sees what failed, and the destination never appears. Only values long
 * enough to be a real destination are matched, so a short or empty field cannot
 * blank out an entire message.
 */
const MIN_REDACTABLE_LENGTH = 4;

export function redactDestination(
  context: ErrorLogContext,
  secrets: readonly (string | null)[]
): ErrorLogContext {
  if (context.cause === undefined) {
    return context;
  }

  let cause = context.cause;
  for (const secret of secrets) {
    if (secret !== null && secret.length >= MIN_REDACTABLE_LENGTH) {
      cause = cause.split(secret).join(REDACTED);
    }
  }

  return { ...context, cause };
}
