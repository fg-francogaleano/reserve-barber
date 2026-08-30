## MODIFIED Requirements

### Requirement: A sweep that does nothing is distinguishable from a sweep with nothing to do

Every invocation SHALL emit one structured summary, **including invocations that expired nothing**, carrying the number of candidates examined, the number expired under each of the two rules, the number of batches, and the run's duration.

**This is the requirement the capability's honesty rests on.** If the job never fires, or cannot reach the database, nothing else in the product looks wrong: availability keeps releasing slots, every page renders correctly, and no client or owner experiences a symptom. Silence is this capability's failure mode, so silence must not also be its success mode.

A booking expired while carrying an `APPROVED` payment SHALL be logged at error level with the booking, the payment and the amount. It is the last surface in the product that can say a refund is owed, and the row stops looking anomalous the moment it is swept.

A missing or unusable database binding SHALL be reported as an error naming the variable, and SHALL NOT be swallowed as an empty run.

**The sweep is no longer the only job on its Worker, and its reporting SHALL survive that.** Another scheduled job now shares the same deployment, and the two SHALL be dispatched separately by the schedule that fired the invocation rather than run from one handler. A fault in the other job SHALL NOT mark a sweep invocation failed, and the sweep's own rethrow — which is what makes a dead job visible in the platform's view of the schedule — SHALL NOT prevent the other job from emitting its summary. The five-minute cadence is unchanged and remains a data-freshness choice.

#### Scenario: A run with nothing to do still reports
- **WHEN** the sweep runs and no booking is eligible
- **THEN** one summary is emitted recording zero expiries and the candidates examined

#### Scenario: An expired booking that was already paid is reported loudly
- **WHEN** a booking carrying an `APPROVED` payment is expired
- **THEN** an error-level entry names the booking, the payment and the amount

#### Scenario: A missing binding is not silence
- **WHEN** the scheduled invocation runs without a usable database connection string
- **THEN** an error naming the variable is emitted rather than a summary reporting zero work

#### Scenario: A co-tenant job's failure does not implicate the sweep
- **WHEN** the other scheduled job on the same Worker throws during its own invocation
- **THEN** no sweep invocation is marked failed and the sweep's summaries are unaffected

#### Scenario: The sweep's failure does not suppress the other job's summary
- **WHEN** a sweep invocation fails and rethrows
- **THEN** the other job's own invocations still run on their own schedule and emit their own summaries

#### Scenario: The two jobs are dispatched by schedule
- **WHEN** a scheduled invocation arrives at the Worker
- **THEN** exactly one job runs, selected by the schedule expression that fired it
