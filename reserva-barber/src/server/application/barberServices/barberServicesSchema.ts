import { z } from 'zod';
import { MAX_SERVICES_PER_OWNER } from '@/server/application/services/ServiceCatalogService';

export type BarberServicesFieldError = 'required' | 'invalid' | 'too_many';

export interface BarberServicesFieldErrors {
  barberId?: BarberServicesFieldError;
  serviceIds?: BarberServicesFieldError;
  renderedServiceIds?: BarberServicesFieldError;
}

/**
 * Normalizes one multi-value form field into a deduplicated id list, or `null`
 * when the payload is not a list of non-empty strings.
 *
 * Deduplication happens **before** the cap is applied, so a repeated checkbox
 * value — which a crafted payload can produce trivially — cannot push a
 * legitimate selection over the limit. Order is preserved rather than sorted:
 * the caller compares sets, and a stable order keeps test failures readable.
 */
function toIdList(value: unknown): string[] | null {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      return null;
    }
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      return null;
    }
    if (!ids.includes(trimmed)) {
      ids.push(trimmed);
    }
  }
  return ids;
}

const barberIdField = z
  .unknown()
  .optional()
  .transform((value) => (typeof value === 'string' ? value.trim() : ''))
  .superRefine((barberId, ctx) => {
    if (barberId.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'required' });
    }
  });

/** The checked subset. Absent means "nothing checked", which is a valid save. */
const selectedField = z
  .unknown()
  .optional()
  .transform((value, ctx) => {
    const ids = toIdList(value);
    if (ids === null) {
      ctx.addIssue({ code: 'custom', message: 'invalid' });
      return z.NEVER;
    }
    if (ids.length > MAX_SERVICES_PER_OWNER) {
      ctx.addIssue({ code: 'custom', message: 'too_many' });
      return z.NEVER;
    }
    return ids;
  });

/**
 * The ids the form rendered — required, and required to be non-empty.
 *
 * This field is what makes an empty selection legible. An all-unchecked form
 * omits the checked-ids key entirely, so without a baseline "the owner
 * unchecked everything" and "the field never arrived" are the same payload.
 * Requiring it non-empty is safe because the editor renders no operable submit
 * control when the owner has no services at all.
 */
const renderedField = z
  .unknown()
  .optional()
  .transform((value, ctx) => {
    const ids = toIdList(value);
    if (ids === null) {
      ctx.addIssue({ code: 'custom', message: 'invalid' });
      return z.NEVER;
    }
    if (ids.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'required' });
      return z.NEVER;
    }
    if (ids.length > MAX_SERVICES_PER_OWNER) {
      ctx.addIssue({ code: 'custom', message: 'too_many' });
      return z.NEVER;
    }
    return ids;
  });

// z.object strips unknown keys — an injected ownerId or isActive cannot reach
// the application service through here.
export const setBarberServicesSchema = z
  .object({
    barberId: barberIdField,
    serviceIds: selectedField,
    renderedServiceIds: renderedField,
  })
  .superRefine((data, ctx) => {
    // A checked id that was never rendered is a malformed submission, not an
    // ownership question: the form cannot produce it. Rejecting it here keeps
    // the application service dealing only with ownership.
    const rendered = new Set(data.renderedServiceIds);
    if (data.serviceIds.some((id) => !rendered.has(id))) {
      ctx.addIssue({ code: 'custom', message: 'invalid', path: ['serviceIds'] });
    }
  });

export type SetBarberServicesInput = z.output<typeof setBarberServicesSchema>;

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; fieldErrors: BarberServicesFieldErrors };

const KNOWN_FIELDS = ['barberId', 'serviceIds', 'renderedServiceIds'] as const;

function toFieldErrors(error: z.ZodError): BarberServicesFieldErrors {
  const fieldErrors: BarberServicesFieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (KNOWN_FIELDS.includes(field as (typeof KNOWN_FIELDS)[number])) {
      const key = field as (typeof KNOWN_FIELDS)[number];
      fieldErrors[key] ??= issue.message as BarberServicesFieldError;
    }
  }
  return fieldErrors;
}

export function parseSetBarberServices(input: unknown): ParseResult<SetBarberServicesInput> {
  const result = setBarberServicesSchema.safeParse(input ?? {});
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, fieldErrors: toFieldErrors(result.error) };
}
