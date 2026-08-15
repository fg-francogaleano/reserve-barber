import type { IPaymentConfigRepository } from '@/server/domain/repositories/IPaymentConfigRepository';
import type { IMercadoPagoCredentialVerifier } from '@/server/domain/repositories/IMercadoPagoCredentialVerifier';
import type { IServiceRepository } from '@/server/domain/repositories/IServiceRepository';
import type {
  PaymentConfig,
  TransferDetails,
  MercadoPagoCredentials,
  MercadoPagoView,
  DepositPolicySettings,
  DepositPolicyInput,
  PaymentReadiness,
} from '@/server/domain/models/PaymentConfig';
import { hasTransferConfigured, isBookable } from '@/server/domain/models/PaymentConfig';
import { describeDeposit } from '@/server/domain/models/depositPolicy';
import {
  credentialEnvironment,
  credentialLastFour,
  type CredentialEnvironment,
} from '@/server/domain/models/mercadoPagoCredentials';
import {
  PaymentConfigWriteConflictError,
  CredentialDecryptionError,
} from '@/server/domain/errors/PaymentConfigErrors';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === code
  );
}

export type SaveTransferResult =
  /**
   * The destination differs from the stored one and has not been confirmed.
   * Nothing was written. `pending` carries the **normalized** value, which is
   * what the owner must be shown — confirming what they typed rather than what
   * would be stored would confirm the wrong thing (design D14).
   */
  | { status: 'needs_confirmation'; pending: TransferDetails }
  /**
   * Written. `leavesNoPaymentMethod` is computed here rather than in the
   * browser: only the server knows whether PC2 has configured Mercado Pago,
   * and the warning must work before hydration (design D16).
   */
  | { status: 'saved'; leavesNoPaymentMethod: boolean };

export interface SaveTransferOptions {
  /** Set by the owner's explicit confirmation of a changed destination. */
  confirmed: boolean;
}

function destinationChanged(stored: TransferDetails, next: TransferDetails): boolean {
  return stored.cbuCvu !== next.cbuCvu || stored.alias !== next.alias;
}

/*
 * `AccountChange` and `compareAccounts` lived here until 2026-08-13, alongside
 * `accountIdFromToken` in the domain (design D6a).
 *
 * They compared the trailing numeric segment of two access tokens to warn an
 * owner that a replacement was switching Mercado Pago accounts. The premise came
 * from the OAuth reference, whose example token ends in the same number as
 * `user_id`. Checked against a real panel-issued credential it did not hold: the
 * trailing segment was 1325562541 while the owner's User ID is 156842883.
 *
 * A comparison of two numbers that identify nothing can be wrong in both
 * directions, and what it guarded was the owner's money — so it was withdrawn
 * rather than weakened. The account identity now comes from Mercado Pago during
 * verification, or is not shown. See T43.
 */

/**
 * Everything the confirmation screen may show about a pending credential
 * change — and nothing that is a secret. The token itself never appears in this
 * type, because this value is serialized into form state and reaches the
 * browser (design D6).
 */
export interface PendingCredentialsSummary {
  environment: CredentialEnvironment | null;
  lastFour: string | null;
  /**
   * Who Mercado Pago says these credentials belong to — a nickname or email.
   *
   * This is now the **only** account identity in the product, and it comes from
   * Mercado Pago rather than from the token. The offline alternative was tried
   * and withdrawn: the token's trailing segment is not the account (T43).
   *
   * Null when Mercado Pago could not be reached, in which case the confirmation
   * falls back to the last four characters and says so. That is weaker than the
   * original design promised, and it is stated plainly rather than papered over.
   */
  displayName: string | null;
  storedLastFour: string | null;
  storedEnvironment: CredentialEnvironment | null;
  /** False when the save would proceed unverified. */
  verified: boolean;
}

export type SaveMercadoPagoResult =
  /**
   * Mercado Pago rejected the credentials. Nothing written; previous intact.
   *
   * There is deliberately no `unchanged` variant: an empty submission is
   * resolved by the parser, which returns before the service is called at all.
   * Carrying a status the service can never produce would force every caller to
   * branch on a case that cannot happen.
   */
  | { status: 'rejected' }
  /** Existing credentials would be replaced and the owner has not confirmed. */
  | { status: 'needs_confirmation'; pending: PendingCredentialsSummary }
  | { status: 'saved'; verified: boolean; leavesNoPaymentMethod: boolean };

export type RemoveMercadoPagoResult =
  | { status: 'needs_confirmation'; pending: PendingCredentialsSummary }
  | { status: 'removed'; leavesNoPaymentMethod: boolean };

export interface SaveMercadoPagoOptions {
  /** Set by the owner's explicit confirmation of a replacement. */
  confirmed: boolean;
}

/**
 * What one policy would charge for one existing service.
 *
 * Carries the price alongside the deposit because the pair is the point: a
 * percentage that is off by a factor of ten is invisible on its own and obvious
 * next to the price it applies to.
 */
export interface DepositEffect {
  serviceId: string;
  serviceName: string;
  price: string;
  deposit: string;
  /** The fixed deposit exceeds this price and was capped down to it. */
  cappedByPrice: boolean;
  /** The computed deposit fell under the minimum and was raised to it. */
  raisedToMinimum: boolean;
}

/**
 * Everything the confirmation screen shows about a pending policy change.
 *
 * The effects are computed on the server, through the same `DepositPolicy`
 * rule the booking flow uses. A client-side preview would be a second
 * implementation of a money calculation (design D6).
 */
export interface PendingDepositPolicy {
  policy: DepositPolicyInput;
  stored: DepositPolicySettings;
  effects: DepositEffect[];
}

export type SaveDepositResult =
  /** A stored policy would be replaced and the owner has not confirmed. */
  | { status: 'needs_confirmation'; pending: PendingDepositPolicy }
  | {
      status: 'saved';
      leavesNoPaymentMethod: boolean;
      /** Services priced below a fixed deposit — reported, never blocking. */
      servicesBelowDeposit: DepositEffect[];
      /** Services whose computed deposit had to be raised to the minimum. */
      servicesBelowMinimum: DepositEffect[];
    };

export type RemoveDepositResult =
  | { status: 'needs_confirmation'; stored: DepositPolicySettings }
  | { status: 'removed'; leavesNoPaymentMethod: boolean };

export interface SaveDepositOptions {
  /** Set by the owner's explicit confirmation of a replacement. */
  confirmed: boolean;
}

const UNCONFIGURED_POLICY: DepositPolicySettings = { type: 'PERCENT', value: null };

const NO_TRANSFER: TransferDetails = { cbuCvu: null, alias: null, holderName: null };

/**
 * Whether a save would replace a policy the owner already has.
 *
 * False when nothing is stored: going from no policy to a policy has no
 * previous value to be confused with, which is the risk the confirmation step
 * exists for. The values are compared numerically because `30` and `30.00` are
 * the same policy — the parser produces the first and the database returns the
 * second, and a string comparison would ask the owner to confirm a change that
 * is not one.
 */
function policyChanged(stored: DepositPolicySettings, next: DepositPolicyInput): boolean {
  if (stored.value === null) return false;
  return stored.type !== next.type || Number(stored.value) !== Number(next.value);
}

/** True when clients have at least one way to pay. */
function hasAnyPaymentMethod(config: PaymentConfig | null): boolean {
  if (config === null) return false;
  return config.hasMercadoPagoCredentials || hasTransferConfigured(config.transfer);
}

export class PaymentConfigService {
  constructor(
    private readonly configs: IPaymentConfigRepository,
    /**
     * Optional so PC1's transfer paths, and every existing test, construct the
     * service exactly as before. A Mercado Pago write without a verifier is a
     * programming error, not a runtime condition, and is reported as one.
     */
    private readonly verifier?: IMercadoPagoCredentialVerifier,
    /**
     * Optional for the same reason, and needed only by the deposit policy
     * paths, which preview a policy against the owner's real service prices.
     * The read paths below work without it.
     */
    private readonly services?: IServiceRepository
  ) {}

  getConfig(ownerId: string): Promise<PaymentConfig | null> {
    return this.configs.findByOwner(ownerId);
  }

  getTransferDetailsForPublic(ownerId: string): Promise<TransferDetails | null> {
    return this.configs.findTransferDetailsForPublic(ownerId);
  }

  async saveTransferDetails(
    ownerId: string,
    details: TransferDetails,
    options: SaveTransferOptions
  ): Promise<SaveTransferResult> {
    const existing = await this.configs.findByOwner(ownerId);

    // Confirmation is deliberately narrow: never on a first configuration,
    // never when only the holder name changed, never on an unchanged re-save.
    // Friction on every save is friction that gets clicked through, and this
    // step is the only defence left against an alias that is valid but belongs
    // to someone else — no checksum can catch that (design D14).
    //
    // The test is whether a destination is STORED, not whether a row exists.
    // The row can exist with no destination at all — after the owner cleared
    // it, and once PC2 creates the row for Mercado Pago alone — and going from
    // nothing to something has no previous value to be confused with. The risk
    // this step exists for is silently REPLACING a destination that was right.
    const replacingStoredDestination =
      existing !== null &&
      hasTransferConfigured(existing.transfer) &&
      destinationChanged(existing.transfer, details);

    if (!options.confirmed && replacingStoredDestination) {
      return { status: 'needs_confirmation', pending: details };
    }

    await this.writeWithSingleRetry(() => this.configs.upsertTransferDetails(ownerId, details));

    const hasMercadoPago = existing?.hasMercadoPagoCredentials ?? false;
    return {
      status: 'saved',
      leavesNoPaymentMethod: !hasMercadoPago && !hasTransferConfigured(details),
    };
  }

  /**
   * What the dashboard may know (design D3): presence, environment, last four,
   * when it changed — never the token.
   *
   * Decrypts on purpose, and discards the plaintext immediately. Without this
   * the page renders a healthy-looking "configured" state over a token nobody
   * can read, and the failure surfaces for the first time in a client's
   * checkout (design D12).
   */
  async getMercadoPagoView(ownerId: string): Promise<MercadoPagoView> {
    const config = await this.configs.findByOwner(ownerId);

    if (config === null || !config.hasMercadoPagoCredentials) {
      return {
        configured: false,
        publicKey: config?.mpPublicKey ?? null,
        environment: null,
        lastFour: null,
        changedAt: config?.updatedAt ?? null,
        unreadable: false,
      };
    }

    const token = await this.readStoredToken(ownerId);

    if (token === null) {
      // Stored but unreadable — its own state, never collapsed into "absent".
      return {
        configured: true,
        publicKey: config.mpPublicKey,
        environment: null,
        lastFour: null,
        changedAt: config.updatedAt,
        unreadable: true,
      };
    }

    return {
      configured: true,
      publicKey: config.mpPublicKey,
      environment: credentialEnvironment(token),
      lastFour: credentialLastFour(token),
      changedAt: config.updatedAt,
      unreadable: false,
    };
  }

  async saveMercadoPagoCredentials(
    ownerId: string,
    credentials: MercadoPagoCredentials,
    options: SaveMercadoPagoOptions
  ): Promise<SaveMercadoPagoResult> {
    const { accessToken, publicKey } = credentials;
    if (accessToken === null || publicKey === null) {
      // The parser guarantees a complete pair reaches here; anything else is a
      // wiring mistake and must not be written half-applied.
      throw new Error('saveMercadoPagoCredentials requires a complete credential pair');
    }

    const existing = await this.configs.findByOwner(ownerId);

    // Verification runs before the confirmation gate, because the confirmation
    // displays what verification returns (design D5/D6). It therefore runs
    // again on the confirming round trip — deliberately: a token revoked
    // between the two steps must not be written just because the owner already
    // pressed confirm.
    const outcome = await this.verify(accessToken);
    if (outcome.status === 'rejected') {
      return { status: 'rejected' };
    }
    const verified = outcome.status === 'verified';
    const displayName = outcome.status === 'verified' ? outcome.account.displayName : null;

    if (!options.confirmed && (existing?.hasMercadoPagoCredentials ?? false)) {
      return {
        status: 'needs_confirmation',
        pending: await this.summarize(ownerId, accessToken, displayName, verified),
      };
    }

    await this.writeWithSingleRetry(() =>
      this.configs.upsertMercadoPagoCredentials(ownerId, credentials)
    );

    return { status: 'saved', verified, leavesNoPaymentMethod: false };
  }

  /**
   * Clearing is permitted even when it leaves no payment method at all: an
   * owner migrating between methods must not be trapped. PC1 settled this, and
   * the bookability gate belongs to the booking flow.
   */
  async removeMercadoPagoCredentials(
    ownerId: string,
    options: SaveMercadoPagoOptions
  ): Promise<RemoveMercadoPagoResult> {
    const existing = await this.configs.findByOwner(ownerId);

    if (!options.confirmed && (existing?.hasMercadoPagoCredentials ?? false)) {
      return {
        status: 'needs_confirmation',
        pending: await this.summarize(ownerId, null, null, false),
      };
    }

    await this.writeWithSingleRetry(() =>
      this.configs.upsertMercadoPagoCredentials(ownerId, { accessToken: null, publicKey: null })
    );

    return {
      status: 'removed',
      leavesNoPaymentMethod: !hasTransferConfigured(
        existing?.transfer ?? { cbuCvu: null, alias: null, holderName: null }
      ),
    };
  }

  /**
   * The stored deposit policy. An owner with no row at all reads as
   * unconfigured rather than as an error — the row is created by the first
   * save, never by a migration or a seed.
   */
  async getDepositPolicy(ownerId: string): Promise<DepositPolicySettings> {
    const config = await this.configs.findByOwner(ownerId);
    if (config === null) {
      return UNCONFIGURED_POLICY;
    }
    return { type: config.depositType, value: config.depositValue };
  }

  /**
   * Whether the business can take bookings (design D9).
   *
   * Reads only what `findByOwner` already returns, and **never** the access
   * token: the presence flag is derived at the repository boundary without
   * decrypting, so a missing `PAYMENT_CREDENTIALS_KEY` cannot break this
   * (design D10).
   */
  async getPaymentReadiness(ownerId: string): Promise<PaymentReadiness> {
    const config = await this.configs.findByOwner(ownerId);

    return isBookable({
      hasMercadoPagoCredentials: config?.hasMercadoPagoCredentials ?? false,
      transfer: config?.transfer ?? NO_TRANSFER,
      depositValue: config?.depositValue ?? null,
    });
  }

  async saveDepositPolicy(
    ownerId: string,
    policy: DepositPolicyInput,
    options: SaveDepositOptions
  ): Promise<SaveDepositResult> {
    const existing = await this.configs.findByOwner(ownerId);
    const stored: DepositPolicySettings =
      existing === null
        ? UNCONFIGURED_POLICY
        : { type: existing.depositType, value: existing.depositValue };

    // Narrow on purpose: never on a first configuration, never on an unchanged
    // re-save. The test is whether a policy is STORED, not whether a row
    // exists — the row is created by whichever payment story came first, and
    // going from nothing to something has no previous value to be confused
    // with (design D7).
    if (!options.confirmed && policyChanged(stored, policy)) {
      return {
        status: 'needs_confirmation',
        pending: { policy, stored, effects: await this.previewPolicy(ownerId, policy) },
      };
    }

    await this.writeWithSingleRetry(() => this.configs.upsertDepositPolicy(ownerId, policy));

    // The policy is stored. Everything below is advisory, so a failure here
    // must not turn a successful write into a reported failure — the owner
    // would be told their money rule did not save when it did. Warnings are
    // dropped rather than allowed to swallow the outcome.
    let effects: DepositEffect[] = [];
    try {
      effects = await this.previewPolicy(ownerId, policy);
    } catch {
      effects = [];
    }

    return {
      status: 'saved',
      leavesNoPaymentMethod: !hasAnyPaymentMethod(existing),
      servicesBelowDeposit: effects.filter((effect) => effect.cappedByPrice),
      servicesBelowMinimum: effects.filter((effect) => effect.raisedToMinimum),
    };
  }

  /**
   * Clearing is permitted even when it leaves the business unable to take
   * bookings: an owner migrating between models must not be trapped. PC1
   * settled this, and the gate belongs to the booking flow.
   */
  async removeDepositPolicy(
    ownerId: string,
    options: SaveDepositOptions
  ): Promise<RemoveDepositResult> {
    const existing = await this.configs.findByOwner(ownerId);
    const stored: DepositPolicySettings =
      existing === null
        ? UNCONFIGURED_POLICY
        : { type: existing.depositType, value: existing.depositValue };

    if (stored.value === null) {
      // Nothing to remove, so nothing is written. The upsert would otherwise
      // create a configuration row holding no configuration — a row whose only
      // content is the absence of content — for an owner who never saved
      // anything. Reported as `removed` because the requested end state is the
      // state already in place.
      return { status: 'removed', leavesNoPaymentMethod: !hasAnyPaymentMethod(existing) };
    }

    if (!options.confirmed) {
      return { status: 'needs_confirmation', stored };
    }

    await this.writeWithSingleRetry(() => this.configs.upsertDepositPolicy(ownerId, null));

    return { status: 'removed', leavesNoPaymentMethod: !hasAnyPaymentMethod(existing) };
  }

  /**
   * What one policy would charge across the owner's existing services.
   *
   * Computed through `computeDepositAmount` — the same function the booking
   * flow calls — so the preview cannot promise an amount the booking would not
   * charge. An owner with no services yields an empty list, which the page
   * renders as an empty state rather than treating as an error.
   */
  private async previewPolicy(
    ownerId: string,
    policy: DepositPolicyInput
  ): Promise<DepositEffect[]> {
    if (this.services === undefined) {
      throw new Error('saveDepositPolicy requires a service repository for the effect preview');
    }

    const services = await this.services.findAllByOwner(ownerId);

    return services.map((service) => {
      // The clamps are reported by the calculation itself, not re-derived here:
      // deriving them would mean a second implementation of steps 1 and 2.
      const breakdown = describeDeposit(policy, service.price);
      return {
        serviceId: service.id,
        serviceName: service.name,
        price: service.price,
        deposit: breakdown.amount,
        cappedByPrice: breakdown.cappedByPrice,
        raisedToMinimum: breakdown.raisedToMinimum,
      };
    });
  }

  private async verify(
    accessToken: string
  ): Promise<
    | { status: 'verified'; account: { displayName: string | null } }
    | { status: 'rejected' }
    | { status: 'unavailable' }
  > {
    if (this.verifier === undefined) {
      throw new Error('saveMercadoPagoCredentials requires a credential verifier');
    }
    return this.verifier.verify(accessToken);
  }

  /**
   * Builds the confirmation payload. Everything here is safe to serialize to
   * the browser; the token itself travels separately and encrypted (design D7).
   */
  private async summarize(
    ownerId: string,
    submittedToken: string | null,
    displayName: string | null,
    verified: boolean
  ): Promise<PendingCredentialsSummary> {
    const storedToken = await this.readStoredToken(ownerId);

    return {
      environment: submittedToken === null ? null : credentialEnvironment(submittedToken),
      lastFour: credentialLastFour(submittedToken),
      displayName,
      storedLastFour: credentialLastFour(storedToken),
      storedEnvironment: storedToken === null ? null : credentialEnvironment(storedToken),
      verified,
    };
  }

  /**
   * The stored token, or null when there is none *or* it cannot be read.
   *
   * Callers here only ever need it to derive non-secret facts — an environment,
   * four characters — and for those an unreadable credential and an absent one
   * lead to the same display. The distinction that does matter is drawn in
   * `getMercadoPagoView`, from the presence flag.
   */
  private async readStoredToken(ownerId: string): Promise<string | null> {
    try {
      return await this.configs.findMercadoPagoAccessToken(ownerId);
    } catch (error) {
      if (error instanceof CredentialDecryptionError) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Absorbs the one violation this write can legitimately produce (design D12).
   *
   * Two concurrent saves against a row that does not yet exist both take the
   * upsert's create branch; the loser receives a unique-constraint violation
   * having done nothing wrong, and reporting that as an infrastructure failure
   * tells the owner their save failed when the stored data is correct. The
   * retry finds the row and takes the update path.
   *
   * Bounded at exactly one attempt. A second violation is a real failure and is
   * surfaced rather than retried again.
   *
   * Takes the write as a callback rather than naming one repository method: PC2
   * writes different columns of the same singleton row and meets exactly the
   * same race. Two copies of a retry policy is two places for it to drift.
   */
  private async writeWithSingleRetry(write: () => Promise<void>): Promise<void> {
    try {
      await write();
      return;
    } catch (error) {
      if (!hasCode(error, UNIQUE_CONSTRAINT_VIOLATION)) {
        throw error;
      }
    }

    try {
      await write();
    } catch (error) {
      if (hasCode(error, UNIQUE_CONSTRAINT_VIOLATION)) {
        throw new PaymentConfigWriteConflictError();
      }
      throw error;
    }
  }
}
