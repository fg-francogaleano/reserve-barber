import { z } from 'zod';
import { normalizeName } from '@/server/domain/models/normalizeName';
import { parseAmount, MAX_PRICE } from '@/server/domain/models/money';
import {
  SLOT_GRANULARITY_MINUTES,
  MIN_DURATION_MINUTES,
  MAX_DURATION_MINUTES,
} from '@/server/domain/models/slotGranularity';

export type ServiceFieldError =
  | 'required'
  | 'invalid_length'
  | 'too_long'
  | 'invalid_format'
  | 'thousands_separator'
  | 'too_many_decimals'
  | 'too_large'
  | 'out_of_range'
  | 'not_multiple';

export interface ServiceFieldErrors {
  id?: ServiceFieldError;
  name?: ServiceFieldError;
  description?: ServiceFieldError;
  price?: ServiceFieldError;
  durationMinutes?: ServiceFieldError;
}

export const SERVICE_NAME_MIN_LENGTH = 2;
export const SERVICE_NAME_MAX_LENGTH = 120;
export const SERVICE_DESCRIPTION_MAX_LENGTH = 500;

/**
 * Re-exported so existing importers keep their import site. The ceiling itself
 * is declared once, in the shared money module, alongside the parser that
 * enforces it.
 */
export { MAX_PRICE };

const DIGITS_ONLY = /^\d+$/;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

// ----------------------------------------------------------------------- name

const nameField = z
  .unknown()
  .optional()
  .transform((value) => normalizeName(asString(value)))
  .superRefine((name, ctx) => {
    if (name.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'required' });
      return;
    }
    if (name.length < SERVICE_NAME_MIN_LENGTH || name.length > SERVICE_NAME_MAX_LENGTH) {
      ctx.addIssue({ code: 'custom', message: 'invalid_length' });
    }
  });

/** A blank description is absence, not an empty value (data-model.md §6). */
const descriptionField = z
  .unknown()
  .optional()
  .transform((value) => asString(value))
  .superRefine((description, ctx) => {
    if (description.length > SERVICE_DESCRIPTION_MAX_LENGTH) {
      ctx.addIssue({ code: 'custom', message: 'too_long' });
    }
  })
  .transform((description) => (description.trim().length === 0 ? null : description));

// ---------------------------------------------------------------------- price

/**
 * Parses a submitted price into a canonical two-decimal string, or returns the
 * reason it cannot.
 *
 * Delegates to the shared money module. Every code `parseAmount` returns is
 * also a `ServiceFieldError`, so the mapping is an identity — kept explicit in
 * the signature rather than cast, so that adding a money code the catalogue has
 * no message for becomes a type error instead of an untranslated string.
 */
export function parsePrice(raw: string): { ok: true; value: string } | { ok: false; code: ServiceFieldError } {
  return parseAmount(raw);
}

const priceField = z
  .unknown()
  .optional()
  .transform((value) => asString(value))
  .transform((raw, ctx) => {
    const result = parsePrice(raw);
    if (!result.ok) {
      ctx.addIssue({ code: 'custom', message: result.code });
      return z.NEVER;
    }
    return result.value;
  });

// ------------------------------------------------------------------- duration

export function parseDuration(
  raw: string
): { ok: true; value: number } | { ok: false; code: ServiceFieldError } {
  const trimmed = raw.trim();

  if (trimmed.length === 0) return { ok: false, code: 'required' };
  // Digits only: rejects "4.5", "-15", "3e1", "abc" without ever calling Number
  // on something that would coerce to a surprising value.
  if (!DIGITS_ONLY.test(trimmed)) return { ok: false, code: 'invalid_format' };

  const value = Number(trimmed);
  if (value < MIN_DURATION_MINUTES || value > MAX_DURATION_MINUTES) {
    return { ok: false, code: 'out_of_range' };
  }
  if (value % SLOT_GRANULARITY_MINUTES !== 0) return { ok: false, code: 'not_multiple' };

  return { ok: true, value };
}

const durationField = z
  .unknown()
  .optional()
  .transform((value) => asString(value))
  .transform((raw, ctx) => {
    const result = parseDuration(raw);
    if (!result.ok) {
      ctx.addIssue({ code: 'custom', message: result.code });
      return z.NEVER;
    }
    return result.value;
  });

// ------------------------------------------------------------------------- id

const idField = z
  .unknown()
  .optional()
  .transform((value) => asString(value).trim())
  .superRefine((id, ctx) => {
    if (id.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'required' });
    }
  });

// --------------------------------------------------------------------- schema

// z.object strips unknown keys — an injected ownerId, isActive, or id-on-create
// cannot reach the service through here.
export const createServiceSchema = z.object({
  name: nameField,
  description: descriptionField,
  price: priceField,
  durationMinutes: durationField,
});

export const updateServiceSchema = z.object({
  id: idField,
  name: nameField,
  description: descriptionField,
  price: priceField,
  durationMinutes: durationField,
});

export type CreateServiceInput = z.output<typeof createServiceSchema>;
export type UpdateServiceInput = z.output<typeof updateServiceSchema>;

export type ParseResult<T> = { ok: true; data: T } | { ok: false; fieldErrors: ServiceFieldErrors };

const KNOWN_FIELDS = ['id', 'name', 'description', 'price', 'durationMinutes'] as const;

function toFieldErrors(error: z.ZodError): ServiceFieldErrors {
  const fieldErrors: ServiceFieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (KNOWN_FIELDS.includes(field as (typeof KNOWN_FIELDS)[number])) {
      const key = field as (typeof KNOWN_FIELDS)[number];
      fieldErrors[key] ??= issue.message as ServiceFieldError;
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

export function parseCreateService(input: unknown): ParseResult<CreateServiceInput> {
  return parseWith(createServiceSchema, input);
}

export function parseUpdateService(input: unknown): ParseResult<UpdateServiceInput> {
  return parseWith(updateServiceSchema, input);
}
