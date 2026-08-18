import type {
  ClientContactInput,
  IClientRepository,
  ResolvedClient,
} from '@/server/domain/repositories/IClientRepository';
import type { PrismaClient } from '@/generated/prisma/client';

/** The unique-violation code, the one this write can legitimately meet. */
const UNIQUE_VIOLATION = 'P2002';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

export class PrismaClientRepository implements IClientRepository {
  constructor(private readonly db: PrismaClient) {}

  /**
   * One conflict-aware write against `(ownerId, email)`.
   *
   * **Not a read followed by a write.** Through a transaction-mode pooler the
   * two would be separate round trips that may not share a connection, so the
   * unique constraint is the guarantee and the upsert is how it is used
   * (`data-model.md` §10).
   *
   * `email` and `phone` arrive already normalized — lowercased, trimmed, and
   * in canonical phone form — from `bookingRequestSchema`. Normalizing here
   * instead would put the rule below the layer that reports its failures.
   *
   * The update branch names only `name` and `phone`: those are the two values
   * a returning client can legitimately change, and the email is the key it
   * was found by.
   */
  async resolve(input: ClientContactInput): Promise<ResolvedClient> {
    try {
      return await this.upsert(input);
    } catch (error) {
      // Two first-ever bookings from the same address can race: both find no
      // row, both attempt the insert, one loses. The retry finds the row the
      // winner committed and takes the update branch. A second violation is a
      // real failure and is not retried again — one bounded retry, the shape
      // PC1 settled for the singleton payment-config row.
      if (!isUniqueViolation(error)) throw error;
      return this.upsert(input);
    }
  }

  private async upsert(input: ClientContactInput): Promise<ResolvedClient> {
    const row = await this.db.client.upsert({
      where: { ownerId_email: { ownerId: input.ownerId, email: input.email } },
      create: {
        ownerId: input.ownerId,
        name: input.name,
        email: input.email,
        phone: input.phone,
      },
      // The owner needs the number that answers today (`data-model.md` §10).
      // The recorded consequence: `Booking` snapshots price and deposit but no
      // contact detail, so this re-labels that client's earlier bookings.
      update: { name: input.name, phone: input.phone },
      select: { id: true },
    });

    return { id: row.id };
  }
}
