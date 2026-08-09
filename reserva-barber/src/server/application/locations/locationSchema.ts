import { z } from 'zod';
import { normalizeName } from '@/server/domain/models/normalizeName';

/**
 * Validation for the location forms, per `docs/backend-standards.md`
 * (all external input validated with Zod at the application boundary).
 *
 * Issue messages are **English codes**, not sentences: the application layer
 * must never carry Spanish (`docs/base-standards.md` §2), and the presentation
 * layer owns the mapping from code to copy. Putting a user-facing message here
 * would leave it one import away from the logger.
 */
export type LocationFieldError = 'required' | 'invalid_length' | 'too_long';

export interface LocationFieldErrors {
  id?: LocationFieldError;
  name?: LocationFieldError;
  address?: LocationFieldError;
}

export const LOCATION_NAME_MIN_LENGTH = 2;
export const LOCATION_NAME_MAX_LENGTH = 120;
export const LOCATION_ADDRESS_MAX_LENGTH = 255;

/**
 * Input arrives from `FormData`, where a field may be a string, `null` when
 * absent, or — if the payload was hand-crafted — anything at all. Everything
 * that is not a string is treated as absent rather than trusted.
 */
function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Note on length: this counts UTF-16 code units while `VarChar(120)` counts
 * characters, so an emoji costs 2 here and 1 in PostgreSQL. The mismatch is in
 * the safe direction — nothing accepted here can overflow the column.
 */
// `.optional()` sits before the transform on purpose: in Zod 4 a bare
// `z.unknown()` is non-optional inside an object, so an absent key would fail
// with Zod's own English message instead of reaching our code check.
const nameField = z.unknown().optional().transform(normalizeNameField).superRefine(checkNameLength);

function normalizeNameField(value: unknown): string {
  return normalizeName(asString(value));
}

function checkNameLength(name: string, ctx: z.RefinementCtx): void {
  if (name.length === 0) {
    ctx.addIssue({ code: 'custom', message: 'required' });
    return;
  }
  if (name.length < LOCATION_NAME_MIN_LENGTH || name.length > LOCATION_NAME_MAX_LENGTH) {
    ctx.addIssue({ code: 'custom', message: 'invalid_length' });
  }
}

/** A blank address is absence, not an empty value — `docs/data-model.md` §4. */
const addressField = z
  .unknown()
  .optional()
  .transform((value) => asString(value).trim())
  .superRefine((address, ctx) => {
    if (address.length > LOCATION_ADDRESS_MAX_LENGTH) {
      ctx.addIssue({ code: 'custom', message: 'too_long' });
    }
  })
  .transform((address) => (address.length === 0 ? null : address));

const idField = z
  .unknown()
  .optional()
  .transform((value) => asString(value).trim())
  .superRefine((id, ctx) => {
    if (id.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'required' });
    }
  });

// `z.object` strips unknown keys, so an injected `ownerId`, `id`, or
// `isActive` in the payload cannot reach the database through here.
export const createLocationSchema = z.object({ name: nameField, address: addressField });
export const updateLocationSchema = z.object({
  id: idField,
  name: nameField,
  address: addressField,
});

export type CreateLocationInput = z.output<typeof createLocationSchema>;
export type UpdateLocationInput = z.output<typeof updateLocationSchema>;

export type ParseResult<T> = { ok: true; data: T } | { ok: false; fieldErrors: LocationFieldErrors };

function toFieldErrors(error: z.ZodError): LocationFieldErrors {
  const fieldErrors: LocationFieldErrors = {};

  for (const issue of error.issues) {
    const field = issue.path[0];
    if (field === 'id' || field === 'name' || field === 'address') {
      // First issue per field wins; the checks are ordered so the first is the
      // most specific one worth showing.
      fieldErrors[field] ??= issue.message as LocationFieldError;
    }
  }
  return fieldErrors;
}

function parseWith<T>(schema: z.ZodType<T>, input: unknown): ParseResult<T> {
  const result = schema.safeParse(input ?? {});

  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, fieldErrors: toFieldErrors(result.error) };
}

export function parseCreateLocation(input: unknown): ParseResult<CreateLocationInput> {
  return parseWith(createLocationSchema, input);
}

export function parseUpdateLocation(input: unknown): ParseResult<UpdateLocationInput> {
  return parseWith(updateLocationSchema, input);
}
