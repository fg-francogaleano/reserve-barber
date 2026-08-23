## MODIFIED Requirements

### Requirement: The hold expires, and never after the appointment has started

A new booking SHALL be created with status `PENDING_PAYMENT` and a non-null `holdExpiresAt` equal to the current instant plus the hold duration, **clamped so that it never exceeds `startTime`**.

The hold duration SHALL be a named constant of **15 minutes** at creation, declared beside the other booking-time bounds and documented as a judgement rather than a measurement — no real shop has used this product, and the value is the first thing a real one will want changed.

**The hold duration is no longer a single constant for the lifetime of a booking.** A second named constant, `TRANSFER_HOLD_DURATION_MINUTES` (**45**), governs the extension applied when a client commits to paying by bank transfer, and it SHALL be declared beside the creation constant with the same disclosure that it is a judgement. The creation constant is sized for a hosted checkout; the transfer constant is sized for authenticating into a banking app, registering a destination, transferring, capturing and uploading.

**Any write that sets or moves `holdExpiresAt` SHALL apply the same clamp**, expressed once and called by each writer rather than restated. The clamp is correctness, not preference: an unclamped hold on a near-term appointment lapses after the appointment has begun, and the sweeper would then expire a booking whose time has already passed. The minimum booking lead time makes the case rare today and is itself recorded as a guess that will be lowered — and the transfer extension, being three times the creation duration, brings the clamp materially closer to being reached.

#### Scenario: An ordinary hold
- **WHEN** a booking is created for a start time far beyond the hold duration
- **THEN** `holdExpiresAt` is the creation instant plus 15 minutes

#### Scenario: A near-term appointment
- **WHEN** a booking is created for a start time sooner than the hold duration away
- **THEN** `holdExpiresAt` equals `startTime` and never exceeds it

#### Scenario: The status carries its deadline
- **WHEN** any booking is written with status `PENDING_PAYMENT`
- **THEN** `holdExpiresAt` is non-null, satisfying the database check constraint that already exists

#### Scenario: An extension obeys the same clamp
- **WHEN** a transfer commitment extends a hold for an appointment less than 45 minutes away
- **THEN** `holdExpiresAt` equals `startTime` and never exceeds it

#### Scenario: The clamp has one home
- **WHEN** the creation write and the transfer extension are reviewed
- **THEN** both call the same clamping function rather than each expressing the rule
