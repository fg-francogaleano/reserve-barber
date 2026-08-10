/**
 * Builds the log context for a failed database write (design D11).
 *
 * A PostgreSQL constraint violation embeds the offending column values in its
 * message — `Key (ownerId, name)=(owner-root, Corte Clásico) already exists`.
 * Logging it verbatim writes business data into the log stream and lets a
 * submitted value containing quotes or newlines forge fields in structured log
 * output. For those errors the code alone says everything an operator needs.
 *
 * Errors that are **not** recognized keep their message: an unknown failure
 * stripped of its detail cannot be diagnosed by anyone, which is the opposite
 * of the goal.
 */

/** Prisma codes whose message is known to carry submitted values. */
const VALUE_BEARING_CODES = new Set([
  'P2000', // value too long for the column — includes the value
  'P2002', // unique constraint violation — includes the key values
  'P2003', // foreign key constraint violation — includes the key
  'P2025', // record not found — includes the query predicate
]);

/**
 * Declared as a `type`, not an `interface`, on purpose: an interface gets no
 * implicit index signature, so it would not satisfy the logger's
 * `Record<string, unknown>` context parameter.
 */
export type ErrorLogContext = {
  operation: string;
  code?: string;
  cause?: string;
};

function readCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

export function toErrorLogContext(operation: string, error: unknown): ErrorLogContext {
  const code = readCode(error);

  if (code !== undefined && VALUE_BEARING_CODES.has(code)) {
    return { operation, code };
  }

  const cause = error instanceof Error ? error.message : String(error);
  return code === undefined ? { operation, cause } : { operation, code, cause };
}
