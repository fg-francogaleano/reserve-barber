/**
 * A guest client, as the booking write needs it.
 *
 * No `bookings`, no timestamps: the write needs an id to hang a booking on,
 * and nothing above the repository has any use for the rest.
 */
export interface ResolvedClient {
  readonly id: string;
}

/**
 * The contact details a submission carries, already normalized.
 *
 * `email` arrives trimmed and lowercased and `phone` in its canonical form —
 * both done by `bookingRequestSchema`, above this layer, because the
 * `(ownerId, email)` unique index compares raw bytes and the value it
 * compares must already be canonical (`data-model.md` §10).
 */
export interface ClientContactInput {
  readonly ownerId: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
}

/**
 * Repository contract for guest clients.
 *
 * `ownerId` is part of the input rather than a separate argument because it is
 * half of the identity: the same person booking at two unrelated barbershops
 * is two client records, since neither owner may see the other's customer
 * list.
 */
export interface IClientRepository {
  /**
   * The client behind these contact details, created if this owner has never
   * seen the address before.
   *
   * **A conflict-aware write, never a read followed by a write.** The check
   * and the write would be separate round trips against a transaction-mode
   * pooler and may not share a connection, so the unique constraint on
   * `(ownerId, email)` is the guarantee and an upsert is how it is used
   * (`data-model.md` §10).
   *
   * A returning client's `name` and `phone` are **overwritten** with what they
   * just submitted: the owner needs the number that answers today. The
   * accepted consequence is recorded in `data-model.md` §10 — `Booking`
   * snapshots price and deposit but not contact details, so an overwrite
   * re-labels that client's earlier bookings.
   */
  resolve(input: ClientContactInput): Promise<ResolvedClient>;
}
