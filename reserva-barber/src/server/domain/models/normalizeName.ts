const ZERO_WIDTH_CHARACTERS = /[​-‍﻿]/g;

// U+202A–U+202E: LTR/RTL embedding and override characters
// U+2066–U+2069: LTR/RTL/FSI isolate and pop directional isolate
const BIDI_CONTROL_CHARACTERS = /[‪-‮⁦-⁩]/g;

/**
 * Shared canonical-form rule for any entity name subject to a uniqueness
 * constraint (docs/data-model.md §4 and §5). The rule has exactly one
 * implementation; two entities must not disagree about what "the same name"
 * means (design D7, M2).
 *
 * Order: NFC first (composition can introduce whitespace-adjacent changes),
 * then strip invisible characters (zero-width and bidi controls), then
 * collapse remaining whitespace.
 */
export function normalizeName(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(ZERO_WIDTH_CHARACTERS, '')
    .replace(BIDI_CONTROL_CHARACTERS, '')
    .replace(/\s+/g, ' ')
    .trim();
}
