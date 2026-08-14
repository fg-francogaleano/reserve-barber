// GATE PC2 (Node leg) — Web Crypto AES-GCM for credential encryption.
//
// Runs the shared probes under Node. Passing here proves the *expectations* are
// right; it does NOT prove the deployment runtime behaves the same, because
// Node's Web Crypto and workerd's are different implementations. The runtime
// leg is served by app/api/_gate/cipher, exercised on the workerd preview and
// then removed — the M5a precedent.
//
//   npx tsx scripts/pc2-gate.ts
import { runCipherProbes } from '../src/server/infrastructure/crypto/WebCryptoCipher.probe';

// Wrapped rather than top-level: tsx transforms this to CJS, where a top-level
// await is a build error.
async function main(): Promise<void> {
  console.log(`runtime: node ${process.version}\n`);

  const results = await runCipherProbes();
  for (const { name, passed, detail } of results) {
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  }

  const failed = results.filter((r) => !r.passed).length;
  if (failed > 0) {
    console.error(
      `\n${failed} probe(s) failed. The cipher is the gate for the whole change — ` +
        'do not build the credential editor on a cipher that does not hold here.'
    );
    process.exitCode = 1;
  } else {
    console.log('\nPC2 gate (Node leg) passed.');
  }
}

void main();
