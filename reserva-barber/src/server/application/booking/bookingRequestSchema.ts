import { z } from 'zod';
import { normalizeName } from '@/server/domain/models/normalizeName';
import { parsePhone } from '@/server/domain/models/phone';

/**
 * The booking submission, validated before anything reads the database.
 *
 * Every value here arrives from a stranger on an unauthenticated endpoint, so
 * **the length bounds run before any other work** — a crafted payload must not
 * be able to turn one request into an expensive query or an expensive regular
 * expression. That ordering is the reason each field bounds its raw input
 * first and interprets it second.
 *
 * The three catalogue ids and the two schedule parameters are bounded here and
 * **verified elsewhere**: what makes an id real is finding it in a catalogue
 * built under the owner's scope, and what makes a time real is finding it in a
 * freshly generated slot list. This schema's job is to refuse the absurd, not
 * to decide the true.
 */

export type BookingFieldError =
  | 'required'
  | 'too_short'
  | 'too_long'
  | 'invalid_email'
  | 'invalid_phone';

export interface BookingFieldErrors {
  name?: BookingFieldError;
  email?: BookingFieldError;
  phone?: BookingFieldError;
}

export const CLIENT_NAME_MIN_LENGTH = 2;
export const CLIENT_NAME_MAX_LENGTH = 120;
export const CLIENT_EMAIL_MAX_LENGTH = 255;
/** The stored column's bound. Raw input is capped well below it before parsing. */
export const CLIENT_PHONE_MAX_LENGTH = 30;
/** Generous rather than exact, like `MAX_ID_LENGTH`: it refuses absurdity cheaply. */
const MAX_RAW_PHONE_LENGTH = 40;
const MAX_ID_LENGTH = 128;
const MAX_SCHEDULE_PARAM_LENGTH = 32;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * A bounded opaque token: an id or a schedule parameter.
 *
 * Rejection here is never reported per-field to the client. These values are
 * not typed by anyone — they are carried by the form from the selection the
 * client already made — so a failure means the submission was crafted or the
 * page was tampered with, and the flow's answer is to send them back to the
 * step rather than to annotate a hidden input.
 */
function boundedToken(maxLength: number) {
  return z
    .unknown()
    .optional()
    .transform((value) => asString(value).trim())
    .superRefine((value, ctx) => {
      if (value.length === 0) {
        ctx.addIssue({ code: 'custom', message: 'required' });
        return;
      }
      if (value.length > maxLength) {
        ctx.addIssue({ code: 'custom', message: 'too_long' });
      }
    });
}

const nameField = z
  .unknown()
  .optional()
  // Bounded on the RAW value first. `normalizeName` collapses whitespace, so a
  // megabyte of spaces would normalize to nothing and read as merely "required"
  // — after this process had already walked the megabyte.
  .superRefine((value, ctx) => {
    if (asString(value).length > CLIENT_NAME_MAX_LENGTH) {
      ctx.addIssue({ code: 'custom', message: 'too_long' });
    }
  })
  .transform((value) => normalizeName(asString(value)))
  .superRefine((name, ctx) => {
    if (name.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'required' });
      return;
    }
    if (name.length < CLIENT_NAME_MIN_LENGTH) {
      ctx.addIssue({ code: 'custom', message: 'too_short' });
    }
    if (name.length > CLIENT_NAME_MAX_LENGTH) {
      ctx.addIssue({ code: 'custom', message: 'too_long' });
    }
  });

/**
 * The address, **lowercased and trimmed here** so that every consumer below
 * receives the canonical form.
 *
 * `data-model.md` §10: the `(ownerId, email)` unique index compares raw bytes,
 * so normalization has to happen before the value reaches it or two spellings
 * of one address become two clients.
 */
const emailField = z
  .unknown()
  .optional()
  .superRefine((value, ctx) => {
    if (asString(value).length > CLIENT_EMAIL_MAX_LENGTH) {
      ctx.addIssue({ code: 'custom', message: 'too_long' });
    }
  })
  .transform((value) => asString(value).trim().toLowerCase())
  .superRefine((email, ctx) => {
    if (email.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'required' });
      return;
    }
    if (!z.email().safeParse(email).success) {
      ctx.addIssue({ code: 'custom', message: 'invalid_email' });
    }
  });

/**
 * The phone, normalized to one canonical form by the domain rule (design D11).
 *
 * Tolerant on what it accepts, strict on what it stores: separators and
 * spellings never cause a rejection, only a digit count that cannot form an
 * Argentine number does.
 */
const phoneField = z
  .unknown()
  .optional()
  .superRefine((value, ctx) => {
    if (asString(value).length > MAX_RAW_PHONE_LENGTH) {
      ctx.addIssue({ code: 'custom', message: 'too_long' });
    }
  })
  .transform((value) => asString(value).trim())
  .superRefine((raw, ctx) => {
    if (raw.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'required' });
      return;
    }
    if (raw.length > MAX_RAW_PHONE_LENGTH) return;
    if ('error' in parsePhone(raw)) {
      ctx.addIssue({ code: 'custom', message: 'invalid_phone' });
    }
  })
  .transform((raw) => {
    const parsed = parsePhone(raw);
    return 'canonical' in parsed ? parsed.canonical : raw;
  });

// z.object strips unknown keys, so an injected price, deposit, status or
// ownerId cannot reach the service through here. Both snapshots are derived
// on the server (spec: "The price and the deposit are snapshotted once").
export const bookingRequestSchema = z.object({
  slug: boundedToken(MAX_ID_LENGTH),
  locationId: boundedToken(MAX_ID_LENGTH),
  serviceId: boundedToken(MAX_ID_LENGTH),
  barberId: boundedToken(MAX_ID_LENGTH),
  fecha: boundedToken(MAX_SCHEDULE_PARAM_LENGTH),
  hora: boundedToken(MAX_SCHEDULE_PARAM_LENGTH),
  name: nameField,
  email: emailField,
  phone: phoneField,
});

export type BookingRequestInput = z.output<typeof bookingRequestSchema>;

export type BookingRequestParseResult =
  | { ok: true; data: BookingRequestInput }
  /** `selectionInvalid` means a bounded token failed — send them back to the step. */
  | { ok: false; fieldErrors: BookingFieldErrors; selectionInvalid: boolean };

const CONTACT_FIELDS = ['name', 'email', 'phone'] as const;

function isContactField(field: unknown): field is (typeof CONTACT_FIELDS)[number] {
  return CONTACT_FIELDS.includes(field as (typeof CONTACT_FIELDS)[number]);
}

export function parseBookingRequest(input: unknown): BookingRequestParseResult {
  const result = bookingRequestSchema.safeParse(input ?? {});

  if (result.success) {
    return { ok: true, data: result.data };
  }

  const fieldErrors: BookingFieldErrors = {};
  let selectionInvalid = false;

  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (isContactField(field)) {
      fieldErrors[field] ??= issue.message as BookingFieldError;
    } else {
      selectionInvalid = true;
    }
  }

  return { ok: false, fieldErrors, selectionInvalid };
}
