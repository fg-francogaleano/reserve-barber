/**
 * A bookable service offered by the business.
 *
 * `price` is a **canonical string** with exactly two decimal places, never the
 * driver's decimal type and never a number (design D3). The driver's decimal is
 * not a plain serializable value: it does not survive the boundary between a
 * Server Component and a Client Component, and that failure appears only at
 * runtime on `workerd` — not in a production build and not under the Node test
 * runner. Floating point is excluded separately by the money convention in
 * `docs/data-model.md`.
 *
 * The conversion happens in exactly one place: the repository's `toDomain`.
 */
export class Service {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly description: string | null,
    public readonly price: string,
    public readonly durationMinutes: number,
    public readonly isActive: boolean
  ) {}
}
