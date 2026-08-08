/**
 * Domain entity representing the single administrative user.
 * Zero external dependencies — pure domain model. Never carries credentials;
 * authentication state lives entirely in Supabase Auth (see `authUserId`).
 */
export class Owner {
  constructor(
    public readonly id: string,
    public readonly email: string,
    public readonly authUserId: string | null
  ) {}
}
