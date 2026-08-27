/**
 * The parameter that opens the client's cancellation confirmation (C1).
 *
 * **Step one of two, and it is a `GET` that writes nothing.** This is the
 * mitigation `tech-debt.md` T69 demands of this story rather than a matter of
 * taste: the token addressing the booking travels to an address this product
 * has never verified, so a cancel-by-URL would be fired by a mail scanner, a
 * link-preview bot, a corporate security gateway that fetches every link in an
 * inbound message, a mistaken recipient, or the framework's own link
 * prefetching. None of them intends to cancel anything; all of them would.
 *
 * So a fetch of this URL renders a panel and nothing else, and the cancellation
 * is a `POST` submitted by somebody who read it.
 */

/** Spanish, like every other query parameter in this flow. */
export const CANCEL_CONFIRM_PARAM = 'cancelar';

/** The one value that opens the panel. Matched, never interpreted. */
const CANCEL_CONFIRM_VALUE = '1';

/**
 * Whether the confirmation panel was asked for.
 *
 * **Matched against one exact string, never tested for truthiness.** A
 * parameter that opens a panel about an irreversible action is not a place for
 * a lenient read, and the alternatives all accept things this page never emits:
 * `Boolean(raw)` accepts `'0'` and `'false'`, and a `!== undefined` test accepts
 * an empty value.
 *
 * **It takes the raw framework value, array and all**, which is the lesson T62
 * left behind. There, the page flattened a repeated parameter to `undefined`
 * before the clamp saw it, and `undefined` meant "first arrival" — so
 * `?intento=2&intento=2` restarted a counter whose own test asserted that an
 * array was malformed. The test was true of the module and false of its only
 * caller. Here the decision about an array lives where the rule lives.
 */
export function isCancellationConfirmationRequested(
  raw: string | string[] | undefined
): boolean {
  return raw === CANCEL_CONFIRM_VALUE;
}
