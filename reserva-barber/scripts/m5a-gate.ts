// GATE M5a (Node leg) — timezone support for the business zone.
//
// Runs the shared probes under Node, which has full ICU. Passing here proves
// the *expectations* are right; it does NOT prove the deployment runtime has
// timezone data, because Node's ICU and workerd's are different builds. The
// runtime leg is served by app/api/_gate/timezone, exercised on the workerd
// preview and then removed.
//
//   npx tsx scripts/m5a-gate.ts
import { runTimezoneProbes, PROBE_ZONE } from '../src/server/domain/models/businessTime.probe';

console.log(`zone: ${PROBE_ZONE}`);
console.log(`runtime: node ${process.version}\n`);

const results = runTimezoneProbes();
for (const { name, passed, detail } of results) {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

const failed = results.filter((r) => !r.passed).length;
if (failed > 0) {
  console.error(
    `\n${failed} probe(s) failed. Per design D5 the fallback is a fixed ${'-03:00'} offset constant — ` +
      'record it in docs/s0-versions-decision.md rather than improvising per call.'
  );
  process.exitCode = 1;
} else {
  console.log('\nM5a gate (Node leg) passed.');
}
