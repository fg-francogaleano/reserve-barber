import type { ErrorLogContext } from '@/server/infrastructure/errorLogContext';
import { redactSecrets } from '@/server/infrastructure/redactSecrets';

/**
 * Removes a submitted transfer destination from a log context (design D9).
 *
 * The implementation moved to `redactSecrets` when PC2 needed the same guard
 * for Mercado Pago credentials. This name is kept because it says what the
 * transfer action is protecting, and because PC1's tests pin this behaviour;
 * the logic now has one home.
 */
export function redactDestination(
  context: ErrorLogContext,
  secrets: readonly (string | null)[]
): ErrorLogContext {
  return redactSecrets(context, secrets);
}
