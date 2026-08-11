## MODIFIED Requirements

### Requirement: An out-of-range weekday is rejected in full
The schedule action SHALL accept only the seven known weekdays. It reads exactly one start and one end field per weekday from 0 to 6 and ignores any other field, so the payload is bounded **by construction** rather than by a validator running — an injected `start-7` is never read and cannot produce a window.

The schedule parser, which the action feeds and which other callers may reach directly, SHALL reject a weekday outside 0–6 or one that is not an integer, and SHALL reject the **entire** submission rather than skipping the offending day.

A fractional value is the dangerous case for that parser: it satisfies a naive range comparison and then matches no day, so the window it carries would be discarded while the save reported success.

This wording replaces an earlier version claiming that a submission carrying an out-of-range weekday is rejected outright. It is not: the action silently ignores the extra field and the save succeeds. Both behaviours are safe — no invalid row can be written either way — but only one is true, and the story that builds slot generation will read this text.

#### Scenario: A weekday outside the range
- **WHEN** the parser receives a submission carrying a weekday of 7 or -1
- **THEN** the whole submission is rejected and no window is written for any day
- **AND** when the same field arrives at the action instead, it is ignored and the seven valid days are still saved

#### Scenario: A non-integer weekday
- **WHEN** the parser receives a submission carrying a weekday of 0.5
- **THEN** the whole submission is rejected rather than silently dropping that window

#### Scenario: An unknown weekday field is ignored by the action
- **WHEN** a crafted submission carries `start-7` alongside seven valid days
- **THEN** the seven valid days are saved
- **AND** no window exists for any weekday outside 0–6
