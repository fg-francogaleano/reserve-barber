## MODIFIED Requirements

### Requirement: Income joins through the booking, is bounded by approval, and is named as deposits

The income counter SHALL sum `Payment.amount` under four conditions, each independently required:

1. **The payment's booking SHALL be `CONFIRMED`.** A payment may be `APPROVED` while its booking is not: the late-confirmation path produces exactly that when a client pays for a slot that was already resold, and the sweep logs it as money owed back. Summing approved payments alone reports a refund the owner owes as revenue they earned.
2. **The month SHALL be bounded on `approvedAt`**, not on the payment's creation and not on the appointment's start. Income is when the money moved. Both writers set this column: the Mercado Pago confirmation and the owner's transfer approval.
3. **The figure SHALL be labelled as deposits collected**, not as income or turnover. This product never records the balance a client pays in the chair, so a label reading "Ingresos" is wrong by the whole service price. No string in this capability may imply that the figure is the shop's revenue.
4. **The label SHALL state that the month is the month of approval** — deposits *approved during* this month — and not merely that the figure is deposits.

   Condition 3 was sufficient while this was the product's only income figure. It no longer is. The statistics capability reports deposits belonging to a period's **appointments**, bounded on `Booking.startTime`; this counter reports deposits **approved** in the month, bounded on `Payment.approvedAt`. Both are correct and they will not agree — a deposit approved on 25 August for a 3 September appointment is in this counter's August and in the statistics page's September. Two unequal figures both labelled "señas cobradas", on two pages of one dashboard, is a defect in the labels rather than in either number.

The sum SHALL cross the repository boundary as a canonical decimal string and SHALL NOT be converted to a floating-point number at any point before formatting. A sum with no matching rows SHALL render as a formatted zero, never as an em-dash or a blank: no income is a fact, and a missing value is a different statement.

#### Scenario: An approved payment on an expired booking is excluded

- **WHEN** a payment of 3000.00 reached `APPROVED` this month and its booking was later swept to `EXPIRED`
- **THEN** the income counter does not include it

#### Scenario: An approved payment on a cancelled booking is excluded

- **WHEN** a payment reached `APPROVED` and the owner then rejected the receipt, cancelling the booking
- **THEN** the income counter does not include it

#### Scenario: The month follows the approval, not the appointment

- **WHEN** a deposit is approved on 31 August for an appointment on 3 September
- **THEN** it is counted in August's income

#### Scenario: A trailing zero survives the aggregate

- **WHEN** the only approved deposit this month on a confirmed booking is 2000.50
- **THEN** the counter renders two thousand pesos and fifty centavos, not two thousand pesos and five centavos

#### Scenario: A month with no income is zero, not unknown

- **WHEN** no deposit has been approved this month
- **THEN** the counter renders a formatted zero

#### Scenario: The label does not claim turnover

- **WHEN** the income card is rendered
- **THEN** it states that the figure is deposits collected

#### Scenario: The label states which month it means

- **WHEN** the income card is rendered
- **THEN** it states that the deposits are the ones approved during this month
- **AND** a reader can tell it apart from a figure covering the month's appointments
