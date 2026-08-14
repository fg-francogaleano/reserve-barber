/**
 * GATE PC2 — Web Crypto AES-GCM, run by `scripts/pc2-gate.ts` under Node.
 *
 * Lives beside the module it exercises, following the M5a precedent.
 *
 * What this guards against is the failure mode named in design D1's risk list:
 * the cipher passes every local test and fails in production, because `workerd`
 * and Node ship different Web Crypto implementations and the deployed key
 * exists only in one of them. Every probe asserts a **known outcome** rather
 * than merely that a call returned — a cipher that silently degrades (a reused
 * IV, a tag that is not checked) still round-trips perfectly.
 *
 * **A `workerd` leg was attempted and abandoned.** It was written as
 * `app/api/_gate/cipher/route.ts`, copying M5a's path — but a Next.js folder
 * beginning with `_` is a *private folder* and never becomes a route, so it
 * 404'd on the deployed Worker and had never appeared in the build's route list
 * either. Renaming it would have worked, at the cost of shipping a test route
 * to production and two more deploys.
 *
 * It was dropped rather than renamed because the deployed application had
 * already proved the same thing more convincingly: a credential encrypted
 * locally under `.env` was decrypted by the deployed Worker under the Wrangler
 * secret, against the real database (task 12.7), and the stored column was
 * confirmed to hold a `v1.` envelope with no plaintext. That exercises the real
 * key and the real path.
 *
 * What the deployed check does **not** cover, and this probe does: IV freshness
 * across repeated encryptions, tamper rejection, and the owner/purpose binding.
 * Those are verified under Node only.
 */
// Relative, not aliased: the Node leg runs this through `tsx`, which does not
// resolve the `@/` alias. The M5a probe imports the same way.
import { WebCryptoCipher, ENVELOPE_VERSION } from './WebCryptoCipher';
import { CredentialDecryptionError } from '../../domain/errors/PaymentConfigErrors';

export interface ProbeResult {
  name: string;
  passed: boolean;
  detail: string;
}

const OWNER = 'gate-owner';
const OTHER_OWNER = 'gate-other-owner';
/** Shaped like a real token so the probe exercises a realistic length. */
const SAMPLE = 'APP_USR-0000000000000000-000000-00000000000000000000000000000000-000000000';

/**
 * A fixed key, used only by this gate and never by the application. Generating
 * a random one would make a failure unreproducible; using the real one would
 * put it in a log.
 */
const GATE_KEY = Buffer.from(new Uint8Array(32).fill(42)).toString('base64');

export async function runCipherProbes(): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  const cipher = new WebCryptoCipher(() => GATE_KEY);

  const record = (name: string, passed: boolean, detail: string): void => {
    results.push({ name, passed, detail });
  };

  try {
    const envelope = await cipher.encrypt(SAMPLE, OWNER, 'mp-access-token');
    record(
      'envelope shape',
      envelope.startsWith(`${ENVELOPE_VERSION}.`) && envelope.split('.').length === 3,
      envelope.slice(0, envelope.indexOf('.') + 1) + '…'
    );

    const recovered = await cipher.decrypt(envelope, OWNER, 'mp-access-token');
    record('round trip', recovered === SAMPLE, recovered === SAMPLE ? 'recovered' : 'MISMATCH');

    record('plaintext absent from envelope', !envelope.includes(SAMPLE), 'checked');
  } catch (error) {
    record('round trip', false, `threw: ${(error as Error).name}`);
  }

  // The probe that matters most. A runtime whose getRandomValues is stubbed or
  // whose IV handling is degraded produces identical envelopes, and every other
  // probe here would still pass.
  try {
    const seen = new Set<string>();
    for (let i = 0; i < 10; i += 1) {
      seen.add(await cipher.encrypt(SAMPLE, OWNER, 'mp-access-token'));
    }
    record('initialization vector is fresh per call', seen.size === 10, `${seen.size}/10 distinct`);
  } catch (error) {
    record('initialization vector is fresh per call', false, `threw: ${(error as Error).name}`);
  }

  // Proves the authentication tag is actually verified. A runtime that ignored
  // it would return corrupted plaintext instead of failing.
  try {
    const envelope = await cipher.encrypt(SAMPLE, OWNER, 'mp-access-token');
    const parts = envelope.split('.');
    parts[2] = parts[2][0] === 'A' ? `B${parts[2].slice(1)}` : `A${parts[2].slice(1)}`;
    await cipher.decrypt(parts.join('.'), OWNER, 'mp-access-token');
    record('tampering is rejected', false, 'DECRYPTED A CORRUPTED ENVELOPE');
  } catch (error) {
    record(
      'tampering is rejected',
      error instanceof CredentialDecryptionError,
      (error as Error).name
    );
  }

  try {
    const envelope = await cipher.encrypt(SAMPLE, OWNER, 'mp-access-token');
    await cipher.decrypt(envelope, OTHER_OWNER, 'mp-access-token');
    record('owner binding is enforced', false, 'DECRYPTED UNDER ANOTHER OWNER');
  } catch (error) {
    record(
      'owner binding is enforced',
      error instanceof CredentialDecryptionError,
      (error as Error).name
    );
  }

  try {
    const envelope = await cipher.encrypt(SAMPLE, OWNER, 'mp-pending-confirmation');
    await cipher.decrypt(envelope, OWNER, 'mp-access-token');
    record('purpose binding is enforced', false, 'DECRYPTED UNDER ANOTHER PURPOSE');
  } catch (error) {
    record(
      'purpose binding is enforced',
      error instanceof CredentialDecryptionError,
      (error as Error).name
    );
  }

  return results;
}
