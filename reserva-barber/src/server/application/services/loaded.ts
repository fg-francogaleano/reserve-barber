/**
 * A region of a page that either loaded or did not.
 *
 * **A discriminated union rather than a nullable value**, because a page has to
 * render three things and only two of them are a value: loaded, and could not
 * load. Collapsing the failure into `null` or into a zero is the defect this
 * type exists to make unrepresentable — an income card silently reading
 * `$ 0,00` is a false statement about money, and it is indistinguishable from a
 * shop that earned nothing.
 *
 * Declared here rather than beside the first service that needed it (D1's
 * dashboard home). D5's statistics page needs exactly this shape for exactly
 * this reason, and a second declaration would put one argument in two files and
 * let them drift — which is how a later reader ends up "simplifying" one of them
 * back into a nullable.
 */
export type Loaded<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };
