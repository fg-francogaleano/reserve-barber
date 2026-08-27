/**
 * What a cancellation submission reports back (C2).
 *
 * Two fields rather than one, matching the receipt review's shape and for the
 * same reason: "it worked" and "it did not" are read differently, and rendering
 * them through a single string leaves the page guessing which it received.
 *
 * No `values` field. Unlike every form in this dashboard there is nothing the
 * owner typed to preserve — a cancellation is one control and a hidden id.
 */
export interface CancelFormState {
  readonly error: string | null;
  readonly notice: string | null;
}

export const EMPTY_CANCEL_STATE: CancelFormState = { error: null, notice: null };
