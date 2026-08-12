import { z } from 'zod';
import { normalizeName } from '@/server/domain/models/normalizeName';
import { slugify, SLUG_MIN_LENGTH } from '@/server/domain/models/slugify';
import {
  isSocialPlatform,
  MAX_SOCIAL_LINKS,
  type SocialPlatform,
} from '@/server/domain/models/BusinessProfile';

export type BusinessProfileFieldError =
  | 'required'
  | 'invalid_length'
  | 'too_long'
  | 'invalid_format'
  | 'invalid_protocol'
  | 'unknown_platform'
  | 'duplicate_platform'
  | 'too_many';

export interface BusinessProfileFieldErrors {
  businessName?: BusinessProfileFieldError;
  bio?: BusinessProfileFieldError;
  publicSlug?: BusinessProfileFieldError;
  photo?: BusinessProfileFieldError;
  cover?: BusinessProfileFieldError;
  /** Keyed by submitted row index, so the editor can mark the offending row. */
  socialLinks?: Record<number, BusinessProfileFieldError>;
  /** Set-level rather than row-level: no single row is at fault. */
  socialLinksForm?: BusinessProfileFieldError;
}

export const BUSINESS_NAME_MIN_LENGTH = 2;
export const BUSINESS_NAME_MAX_LENGTH = 120;
export const BIO_MAX_LENGTH = 1000;
export const SOCIAL_URL_MAX_LENGTH = 500;

/**
 * The only protocols a social link may carry.
 *
 * Checked by parsing the URL, never by pattern. These strings are rendered as
 * `href` on a page anonymous clients open, so a stored `javascript:` URL is
 * stored cross-site scripting — an approximating regex is the classic way to let
 * one through (design D9).
 */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * What the owner said about an image slot. Three states, never inferred from
 * whether a file arrived: an HTML form resubmits empty file inputs, so
 * "no file" means "untouched" far more often than it means "delete this"
 * (design D4).
 */
export type ImageIntent =
  | { intent: 'unchanged' }
  | { intent: 'remove' }
  | { intent: 'replace'; file: File };

export interface SocialLinkInput {
  platform: SocialPlatform;
  url: string;
  orderIndex: number;
}

export interface SaveBusinessProfileInput {
  businessName: string;
  bio: string | null;
  publicSlug: string;
  socialLinks: SocialLinkInput[];
  photo: ImageIntent;
  cover: ImageIntent;
}

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; fieldErrors: BusinessProfileFieldErrors };

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(asString) : [];
}

// ------------------------------------------------------------- simple fields

function parseBusinessName(
  raw: unknown
): { ok: true; value: string } | { ok: false; code: BusinessProfileFieldError } {
  const name = normalizeName(asString(raw));

  if (name.length === 0) return { ok: false, code: 'required' };
  if (name.length < BUSINESS_NAME_MIN_LENGTH || name.length > BUSINESS_NAME_MAX_LENGTH) {
    return { ok: false, code: 'invalid_length' };
  }

  return { ok: true, value: name };
}

function parseBio(
  raw: unknown
): { ok: true; value: string | null } | { ok: false; code: BusinessProfileFieldError } {
  const bio = asString(raw);

  // Length is checked before blanking so an over-long string of whitespace is
  // still reported rather than silently becoming absence.
  if (bio.length > BIO_MAX_LENGTH) return { ok: false, code: 'too_long' };

  return { ok: true, value: bio.trim().length === 0 ? null : bio };
}

/**
 * The slug canonicalizes rather than validates, wherever it can.
 *
 * `don--juan`, `-don-juan-` and `Don Juan` are not mistakes the owner has to go
 * back and fix — they all mean the same slug, and `slugify` says which. Only
 * input that carries no slug at all, or one too short to be usable, is refused.
 * Over-long input is clamped by `slugify` for the same reason.
 */
function parseSlug(
  raw: unknown
): { ok: true; value: string } | { ok: false; code: BusinessProfileFieldError } {
  const slug = slugify(asString(raw));

  if (slug.length === 0) return { ok: false, code: 'required' };
  if (slug.length < SLUG_MIN_LENGTH) return { ok: false, code: 'invalid_length' };

  return { ok: true, value: slug };
}

// ------------------------------------------------------------- social links

function parseSocialUrl(
  raw: string
): { ok: true; value: string } | { ok: false; code: BusinessProfileFieldError } {
  const url = raw.trim();

  if (url.length === 0) return { ok: false, code: 'required' };
  if (url.length > SOCIAL_URL_MAX_LENGTH) return { ok: false, code: 'too_long' };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, code: 'invalid_format' };
  }

  // `new URL` lowercases the protocol and ignores leading whitespace, so the
  // cased and padded variants of `javascript:` all land here as `javascript:`.
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return { ok: false, code: 'invalid_protocol' };

  return { ok: true, value: url };
}

interface SocialLinkParse {
  links: SocialLinkInput[];
  rowErrors: Record<number, BusinessProfileFieldError>;
  formError?: BusinessProfileFieldError;
}

function parseSocialLinks(platformsRaw: unknown, urlsRaw: unknown): SocialLinkParse {
  const platforms = asStringArray(platformsRaw);
  const urls = asStringArray(urlsRaw);
  const rowCount = Math.max(platforms.length, urls.length);

  const links: SocialLinkInput[] = [];
  const rowErrors: Record<number, BusinessProfileFieldError> = {};
  const seen = new Set<string>();

  for (let row = 0; row < rowCount; row += 1) {
    const platform = (platforms[row] ?? '').trim();
    const url = (urls[row] ?? '').trim();

    // A fully blank row is absence, not an error: the editor renders empty rows
    // for the owner to fill, and submitting them untouched must mean nothing.
    if (platform.length === 0 && url.length === 0) continue;

    if (platform.length === 0 || url.length === 0) {
      rowErrors[row] = 'required';
      continue;
    }

    if (!isSocialPlatform(platform)) {
      rowErrors[row] = 'unknown_platform';
      continue;
    }

    // Reported on the second occurrence, which is the one the owner has to
    // change. Caught here rather than at the database constraint: reaching that
    // aborts a transaction whose images have already been uploaded (design D9).
    if (seen.has(platform)) {
      rowErrors[row] = 'duplicate_platform';
      continue;
    }

    const parsedUrl = parseSocialUrl(url);
    if (!parsedUrl.ok) {
      rowErrors[row] = parsedUrl.code;
      continue;
    }

    seen.add(platform);
    // Position among the surviving rows, not the submitted row index — blank
    // rows in the middle must not leave gaps in the display order.
    links.push({ platform, url: parsedUrl.value, orderIndex: links.length });
  }

  // Checked against submitted rows rather than accepted ones so seven valid
  // links plus one duplicate reports both problems.
  const submittedRows = rowCount - countBlankRows(platforms, urls, rowCount);
  const formError = submittedRows > MAX_SOCIAL_LINKS ? ('too_many' as const) : undefined;

  return { links, rowErrors, formError };
}

function countBlankRows(platforms: string[], urls: string[], rowCount: number): number {
  let blank = 0;
  for (let row = 0; row < rowCount; row += 1) {
    if ((platforms[row] ?? '').trim().length === 0 && (urls[row] ?? '').trim().length === 0) {
      blank += 1;
    }
  }
  return blank;
}

// ------------------------------------------------------------ image intents

function isUsableFile(value: unknown): value is File {
  return value instanceof File && value.size > 0;
}

function parseImageIntent(
  intentRaw: unknown,
  fileRaw: unknown
): { ok: true; value: ImageIntent } | { ok: false; code: BusinessProfileFieldError } {
  const intent = asString(intentRaw).trim();

  // An absent intent is "untouched". This is the default on purpose: it is the
  // state a resubmitted form produces, and the safe reading of silence.
  if (intent.length === 0 || intent === 'unchanged') return { ok: true, value: { intent: 'unchanged' } };
  if (intent === 'remove') return { ok: true, value: { intent: 'remove' } };

  if (intent === 'replace') {
    // The client only sets `replace` when it has attached a file, so arriving
    // without one is a broken submission rather than a change of mind. Falling
    // back to `unchanged` here would hide that.
    if (!isUsableFile(fileRaw)) return { ok: false, code: 'required' };
    return { ok: true, value: { intent: 'replace', file: fileRaw } };
  }

  return { ok: false, code: 'invalid_format' };
}

// ------------------------------------------------------------------- schema

/**
 * Accepts only the keys the form is allowed to submit. An injected `id`,
 * `ownerId` or timestamp is dropped here and cannot reach the service — the same
 * guarantee `z.object` gives the other schemas.
 */
const rawInputSchema = z
  .object({
    businessName: z.unknown(),
    bio: z.unknown(),
    publicSlug: z.unknown(),
    socialPlatforms: z.unknown(),
    socialUrls: z.unknown(),
    photoIntent: z.unknown(),
    photo: z.unknown(),
    coverIntent: z.unknown(),
    cover: z.unknown(),
  })
  .partial();

/**
 * Parses a submitted profile form.
 *
 * Every field is evaluated, and every failure is collected, rather than
 * returning at the first problem: an owner who has three fields wrong should
 * learn that once, not three times.
 */
export function parseSaveBusinessProfile(input: unknown): ParseResult<SaveBusinessProfileInput> {
  const raw = rawInputSchema.safeParse(input ?? {});
  if (!raw.success) {
    return { ok: false, fieldErrors: { businessName: 'required' } };
  }

  const fields = raw.data;
  const fieldErrors: BusinessProfileFieldErrors = {};

  const businessName = parseBusinessName(fields.businessName);
  if (!businessName.ok) fieldErrors.businessName = businessName.code;

  const bio = parseBio(fields.bio);
  if (!bio.ok) fieldErrors.bio = bio.code;

  const publicSlug = parseSlug(fields.publicSlug);
  if (!publicSlug.ok) fieldErrors.publicSlug = publicSlug.code;

  const social = parseSocialLinks(fields.socialPlatforms, fields.socialUrls);
  if (Object.keys(social.rowErrors).length > 0) fieldErrors.socialLinks = social.rowErrors;
  if (social.formError) fieldErrors.socialLinksForm = social.formError;

  const photo = parseImageIntent(fields.photoIntent, fields.photo);
  if (!photo.ok) fieldErrors.photo = photo.code;

  const cover = parseImageIntent(fields.coverIntent, fields.cover);
  if (!cover.ok) fieldErrors.cover = cover.code;

  if (
    !businessName.ok ||
    !bio.ok ||
    !publicSlug.ok ||
    !photo.ok ||
    !cover.ok ||
    fieldErrors.socialLinks !== undefined ||
    fieldErrors.socialLinksForm !== undefined
  ) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    data: {
      businessName: businessName.value,
      bio: bio.value,
      publicSlug: publicSlug.value,
      socialLinks: social.links,
      photo: photo.value,
      cover: cover.value,
    },
  };
}
