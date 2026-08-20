import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma-cli/client';
import { WebCryptoCipher } from '../src/server/infrastructure/crypto/WebCryptoCipher';

const PREF = 'https://api.mercadopago.com/checkout/preferences';
const HOST = 'your-humans-certificates-then.trycloudflare.com';

async function attempt(label: string, token: string, scheme: string) {
  const back = `${scheme}://${HOST}/b/x/pago/retorno`;
  const notify = `${scheme}://${HOST}/api/webhooks/mercadopago?ref=diag`;
  const res = await fetch(PREF, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [{ title: 'diag', quantity: 1, unit_price: 2000, currency_id: 'ARS' }],
      external_reference: 'diag-1',
      notification_url: notify,
      back_urls: { success: back, pending: back, failure: back },
      auto_return: 'approved',
      date_of_expiration: new Date(Date.now() + 15 * 60_000).toISOString(),
      metadata: { booking_id: 'diag-1' },
    }),
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.text();
  console.log(`\n--- ${label} -> HTTP ${res.status}`);
  console.log(body.slice(0, 300));
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL!, maxUses: 1 }) });
  const cfg = await prisma.paymentConfig.findFirstOrThrow({ select: { ownerId: true, mpAccessToken: true } });
  const token = await new WebCryptoCipher().decrypt(cfg.mpAccessToken!, cfg.ownerId, 'mp-access-token');
  await prisma.$disconnect();

  await attempt('A. http:// on the public tunnel host (what the app sends)', token, 'http');
  await attempt('B. https:// on the same host', token, 'https');
}
main().catch((e) => { console.error(e); process.exit(1); });
