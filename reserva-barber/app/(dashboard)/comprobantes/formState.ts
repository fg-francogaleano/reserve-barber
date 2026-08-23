/**
 * What a review submission reports back.
 *
 * Two fields rather than one, because "it worked" and "it did not" are read
 * differently and rendering them through a single string would leave the page
 * guessing which it received. No `values` field: unlike every other form in
 * this dashboard there is nothing the owner typed to preserve — a decision is
 * two buttons and a hidden id.
 */
export interface ReviewFormState {
  readonly error: string | null;
  readonly notice: string | null;
}

export const EMPTY_REVIEW_STATE: ReviewFormState = { error: null, notice: null };
