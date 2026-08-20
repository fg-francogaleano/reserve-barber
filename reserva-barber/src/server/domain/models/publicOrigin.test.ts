import { describe, it, expect } from 'vitest';
import { isPubliclyRoutableHost } from './publicOrigin';

describe('hosts a payment must never be initiated against', () => {
  /**
   * **The case that actually happened.** A preference pointing at
   * `https://localhost:8787` was accepted by Mercado Pago, the client paid, the
   * return died with `ERR_CONNECTION_CLOSED`, and the notification went to an
   * address nothing could reach — leaving a real approved charge against a
   * booking that stayed `PENDING_PAYMENT`.
   */
  it.each([
    'localhost',
    'localhost:8787',
    '127.0.0.1',
    '127.0.0.1:3000',
    '0.0.0.0',
    '::1',
    '[::1]',
  ])('refuses %s', (host) => {
    expect(isPubliclyRoutableHost(host)).toBe(false);
  });

  it.each([
    '10.0.0.5',
    '192.168.1.20',
    '172.16.0.1',
    '172.31.255.254',
    '169.254.1.1',
  ])('refuses the private address %s', (host) => {
    expect(isPubliclyRoutableHost(host)).toBe(false);
  });

  it.each([
    'shop.localhost',
    'barberia.local',
    'api.internal',
    'anything.test',
    'nope.invalid',
    // RFC 2606 reserves this one, and it is the host this project's own test
    // fixtures reached for. Listing it as reserved and asserting it routable is
    // the contradiction this line closes.
    'shop.example',
    'shop.example:443',
  ])('refuses the reserved suffix in %s', (host) => {
    expect(isPubliclyRoutableHost(host)).toBe(false);
  });

  // A machine name on somebody's LAN. Every routable host has at least one dot.
  it.each(['myhost', 'dev', 'preview'])('refuses the bare label %s', (host) => {
    expect(isPubliclyRoutableHost(host)).toBe(false);
  });

  it('refuses an empty host', () => {
    expect(isPubliclyRoutableHost('')).toBe(false);
  });
});

describe('hosts a payment may be initiated against', () => {
  it.each([
    'reserva-barber.example.com',
    'barberia-don-juan.com.ar',
    'conclusions-confirmed-targeted-connectors.trycloudflare.com',
    'shop.example.com:443',
    '203.0.113.10',
  ])('accepts %s', (host) => {
    expect(isPubliclyRoutableHost(host)).toBe(true);
  });

  /**
   * `172.15` and `172.32` sit outside RFC 1918's `172.16.0.0/12`. Asserted
   * because a prefix match on `172.` would be the obvious wrong shortcut, and
   * it would refuse perfectly public addresses.
   */
  it.each(['172.15.0.1', '172.32.0.1'])('accepts %s, which is outside the private range', (host) => {
    expect(isPubliclyRoutableHost(host)).toBe(true);
  });

  it('ignores case', () => {
    expect(isPubliclyRoutableHost('SHOP.EXAMPLE.COM')).toBe(true);
    expect(isPubliclyRoutableHost('LOCALHOST')).toBe(false);
  });
});
