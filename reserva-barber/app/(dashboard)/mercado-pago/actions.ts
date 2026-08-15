'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import { parseMercadoPagoCredentials } from '@/server/application/paymentConfig/mercadoPagoCredentialsSchema';
import {
  storePendingCredentials,
  readPendingCredentials,
  clearPendingToken,
  type PendingCookieStore,
} from '@/server/application/paymentConfig/pendingCredentials';
import { credentialLastFour, credentialEnvironment } from '@/server/domain/models/mercadoPagoCredentials';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';
import { redactSecrets } from '@/server/infrastructure/redactSecrets';
import { COPY } from '@/lib/copy';
import { mercadoPagoConfigService, credentialCipher } from './paymentConfigService';
import {
  toMercadoPagoFormState,
  INITIAL_MERCADO_PAGO_STATE,
  type MercadoPagoFormState,
  type MercadoPagoFormValues,
} from './formState';

const MERCADO_PAGO_PATH = '/mercado-pago';

/**
 * Confirmation answers, namespaced per form (T41).
 *
 * `FormData.get` returns the **first** value for a repeated name. These lived
 * as bare `confirm`/`edit`/`remove` while the transfer and Mercado Pago editors
 * were on separate pages; the deposit policy editor made three confirming forms
 * in one settings area, and an unprefixed answer could then be consumed by the
 * wrong action. All three decide where a client's money goes, so the collision
 * was closed before it was reachable rather than after.
 */
const CONFIRM_INTENT = 'mp-confirm';
const EDIT_INTENT = 'mp-edit';
const REMOVE_INTENT = 'mp-remove';
const CONFIRM_REMOVE_INTENT = 'mp-confirm-remove';

function read(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === 'string' ? value : '';
}

function submittedValues(formData: FormData): MercadoPagoFormValues {
  return { publicKey: read(formData, 'publicKey') };
}

function failure(
  state: Partial<MercadoPagoFormState>,
  values: MercadoPagoFormValues
): MercadoPagoFormState {
  return { ...INITIAL_MERCADO_PAGO_STATE, values, ...state };
}

export async function saveMercadoPagoCredentialsAction(
  _prevState: MercadoPagoFormState,
  formData: FormData
): Promise<MercadoPagoFormState> {
  // requireOwner() MUST be the first line — middleware passes next-action
  // through, so this is the entire authorization boundary for the action, and
  // it must precede any outbound call to Mercado Pago.
  const owner = await requireOwner();
  const values = submittedValues(formData);

  // The answer rides on the pressed button as `intent`, never as a hidden field
  // the other button tries to override — `FormData.get` returns the first value
  // for a name, so a hidden "confirm" would beat a "cancel" button and the
  // guard would commit exactly what the owner just declined.
  const intent = read(formData, 'intent');
  const cookieStore = (await cookies()) as unknown as PendingCookieStore;
  const cipher = credentialCipher();
  const service = mercadoPagoConfigService();

  // Going back to the editor writes nothing and validates nothing: the owner is
  // returning to fix a value, and reporting errors about it now would be noise
  // on top of a decision they already made.
  //
  // The public key is re-read from the database rather than taken from the
  // submission: the confirmation screen carries no credential fields at all, so
  // `values` is empty here, and echoing that back would blank a field the owner
  // never cleared.
  if (intent === EDIT_INTENT) {
    clearPendingToken(cookieStore);
    const stored = await service.getMercadoPagoView(owner.id);
    return failure({}, { publicKey: stored.publicKey ?? '' });
  }

  try {
    if (intent === REMOVE_INTENT || intent === CONFIRM_REMOVE_INTENT) {
      // Read before the write, or there is nothing left to name in the log.
      const removedFrom = await service.getMercadoPagoView(owner.id);
      const result = await service.removeMercadoPagoCredentials(owner.id, {
        confirmed: intent === CONFIRM_REMOVE_INTENT,
      });

      if (result.status === 'needs_confirmation') {
        return failure({ pendingConfirmation: result.pending, pendingIntent: 'remove' }, values);
      }

      clearPendingToken(cookieStore);
      // `previousTokenLastFour` is read before the write is acknowledged, so a
      // removal is as reconstructable from the log stream as a rotation is
      // (T35). Without it the most destructive operation left the thinnest
      // trace of the three.
      logger.info('Mercado Pago credentials removed', {
        operation: 'removeMercadoPagoCredentials',
        ownerId: owner.id,
        previousTokenLastFour: removedFrom.lastFour,
        leavesNoPaymentMethod: result.leavesNoPaymentMethod,
      });
      revalidatePath(MERCADO_PAGO_PATH);

      return {
        ...INITIAL_MERCADO_PAGO_STATE,
        removed: true,
        noPaymentMethod: result.leavesNoPaymentMethod,
      };
    }

    const confirming = intent === CONFIRM_INTENT;

    // On the confirming round trip BOTH credentials come from the encrypted
    // cookie, not from the form (design D7).
    //
    // The token, because it was never sent to the browser to be resubmitted.
    // The public key, because the confirmation must commit exactly the pair
    // whose account was verified and shown — reading it back from a form field
    // would let a tampered value be stored against an account the owner
    // approved for a different key. The confirmation screen therefore carries
    // no credential fields at all, which is also what keeps the token out of
    // the DOM.
    //
    // A cookie that expired or cannot be read means there is no confirmation in
    // progress, so the owner returns to the editor rather than to a
    // confirmation that would commit nothing.
    const pending = confirming ? await readPendingCredentials(cookieStore, cipher, owner.id) : null;
    if (confirming && pending === null) {
      clearPendingToken(cookieStore);
      const stored = await service.getMercadoPagoView(owner.id);
      return failure({}, { publicKey: stored.publicKey ?? '' });
    }

    const view = await service.getMercadoPagoView(owner.id);
    const parsed = parseMercadoPagoCredentials(
      {
        accessToken: pending?.accessToken ?? formData.get('accessToken'),
        publicKey: pending?.publicKey ?? formData.get('publicKey'),
      },
      { hasStoredCredentials: view.configured, storedPublicKey: view.publicKey }
    );

    if (!parsed.ok) {
      clearPendingToken(cookieStore);
      return toMercadoPagoFormState(parsed.fieldErrors, values);
    }

    if (parsed.intent === 'unchanged') {
      clearPendingToken(cookieStore);
      return { ...INITIAL_MERCADO_PAGO_STATE, values, saved: true };
    }

    const result = await service.saveMercadoPagoCredentials(owner.id, parsed.data, {
      confirmed: confirming,
    });

    if (result.status === 'rejected') {
      clearPendingToken(cookieStore);
      return failure({ error: COPY.mercadoPago.rejected }, values);
    }

    if (result.status === 'needs_confirmation') {
      // The pair waits encrypted, `httpOnly` and path-scoped. Only the
      // non-secret summary travels to the browser.
      await storePendingCredentials(cookieStore, cipher, owner.id, {
        accessToken: parsed.data.accessToken!,
        publicKey: parsed.data.publicKey!,
      });
      return failure({ pendingConfirmation: result.pending, pendingIntent: 'save' }, values);
    }

    clearPendingToken(cookieStore);

    // Presence, environment and last four only — never a credential (design
    // D14). The previous/new pair is what makes a rotation reconstructable from
    // the log stream if payments later fail, which is T35's trigger.
    logger.info('Mercado Pago credentials updated', {
      operation: 'saveMercadoPagoCredentials',
      ownerId: owner.id,
      environment: credentialEnvironment(parsed.data.accessToken!),
      tokenLastFour: credentialLastFour(parsed.data.accessToken),
      previousTokenLastFour: view.lastFour,
      publicKeyLastFour: credentialLastFour(parsed.data.publicKey),
      verified: result.verified,
      leavesNoPaymentMethod: result.leavesNoPaymentMethod,
    });

    revalidatePath(MERCADO_PAGO_PATH);

    return {
      ...INITIAL_MERCADO_PAGO_STATE,
      // Echoed back normalized, so the owner reads what was actually stored.
      values: { publicKey: parsed.data.publicKey ?? '' },
      saved: true,
      unverified: !result.verified,
      noPaymentMethod: result.leavesNoPaymentMethod,
    };
  } catch (error) {
    // `toErrorLogContext` keeps the message of unrecognized errors so they stay
    // diagnosable — and that exception is exactly how a bearer token could
    // reach the log stream, including via a Mercado Pago body that echoes it.
    logger.error(
      'Mercado Pago credentials write failed',
      redactSecrets(toErrorLogContext('saveMercadoPagoCredentials', error), [
        read(formData, 'accessToken'),
        read(formData, 'publicKey'),
      ])
    );
    // The write may have committed before the connection dropped. Because the
    // token is never displayed, the message points at the two values that can
    // actually answer "did it save": the last four and the last-changed stamp.
    return failure({ error: COPY.mercadoPago.infrastructureError }, values);
  }
}
