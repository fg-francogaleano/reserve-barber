import { z } from 'zod';
import { normalizeName } from '@/server/domain/models/normalizeName';

export type BarberFieldError = 'required' | 'invalid_length' | 'too_long';

export interface BarberFieldErrors {
  id?: BarberFieldError;
  displayName?: BarberFieldError;
  locationId?: BarberFieldError;
  bio?: BarberFieldError;
}

export const BARBER_DISPLAY_NAME_MIN_LENGTH = 2;
export const BARBER_DISPLAY_NAME_MAX_LENGTH = 120;
export const BARBER_BIO_MAX_LENGTH = 500;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeDisplayNameField(value: unknown): string {
  return normalizeName(asString(value));
}

function checkDisplayNameLength(name: string, ctx: z.RefinementCtx): void {
  if (name.length === 0) {
    ctx.addIssue({ code: 'custom', message: 'required' });
    return;
  }
  if (
    name.length < BARBER_DISPLAY_NAME_MIN_LENGTH ||
    name.length > BARBER_DISPLAY_NAME_MAX_LENGTH
  ) {
    ctx.addIssue({ code: 'custom', message: 'invalid_length' });
  }
}

const displayNameField = z
  .unknown()
  .optional()
  .transform(normalizeDisplayNameField)
  .superRefine(checkDisplayNameLength);

const locationIdField = z
  .unknown()
  .optional()
  .transform((value) => asString(value).trim())
  .superRefine((id, ctx) => {
    if (id.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'required' });
    }
  });

/** A blank bio is absence, not an empty value (data-model.md §5). */
const bioField = z
  .unknown()
  .optional()
  .transform((value) => asString(value))
  .superRefine((bio, ctx) => {
    if (bio.length > BARBER_BIO_MAX_LENGTH) {
      ctx.addIssue({ code: 'custom', message: 'too_long' });
    }
  })
  .transform((bio) => (bio.trim().length === 0 ? null : bio));

const idField = z
  .unknown()
  .optional()
  .transform((value) => asString(value).trim())
  .superRefine((id, ctx) => {
    if (id.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'required' });
    }
  });

// z.object strips unknown keys — injected ownerId, isActive, avatarUrl,
// currentLocationId, etc. cannot reach the service through here.
export const createBarberSchema = z.object({
  displayName: displayNameField,
  locationId: locationIdField,
  bio: bioField,
});

export const updateBarberSchema = z.object({
  id: idField,
  displayName: displayNameField,
  locationId: locationIdField,
  bio: bioField,
});

export type CreateBarberInput = z.output<typeof createBarberSchema>;
export type UpdateBarberInput = z.output<typeof updateBarberSchema>;

export type ParseResult<T> = { ok: true; data: T } | { ok: false; fieldErrors: BarberFieldErrors };

function toFieldErrors(error: z.ZodError): BarberFieldErrors {
  const fieldErrors: BarberFieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (
      field === 'id' ||
      field === 'displayName' ||
      field === 'locationId' ||
      field === 'bio'
    ) {
      fieldErrors[field] ??= issue.message as BarberFieldError;
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

export function parseCreateBarber(input: unknown): ParseResult<CreateBarberInput> {
  return parseWith(createBarberSchema, input);
}

export function parseUpdateBarber(input: unknown): ParseResult<UpdateBarberInput> {
  return parseWith(updateBarberSchema, input);
}
