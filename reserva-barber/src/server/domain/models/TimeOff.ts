/**
 * A period in which a barber is unavailable.
 *
 * The range is **half-open**: `[startsAt, endsAt)`. The start is inside the
 * absence, the end is not — matching `Booking`'s interval convention so that
 * availability never has to reconcile two meanings of a boundary
 * (data-model.md §9).
 *
 * Both fields are UTC instants. Rendering them in business local time is the
 * presentation layer's job, exactly as formatting money is.
 */
export class TimeOff {
  constructor(
    public readonly id: string,
    public readonly startsAt: Date,
    public readonly endsAt: Date,
    public readonly reason: string | null
  ) {}
}

/**
 * The shape every consumer other than the absences editor gets.
 *
 * `reason` is deliberately absent rather than nullable: it can hold medical
 * information, and a projection that does not carry the field cannot leak it.
 * That is a stronger guarantee than remembering not to pass the entity onwards
 * (design D6).
 */
export interface TimeOffPeriod {
  startsAt: Date;
  endsAt: Date;
}
