import { describe, it, expect } from 'vitest';
import { resolveOrigin } from './resolveOrigin';

describe('resolveOrigin', () => {
  it('prefers an explicitly configured origin', () => {
    expect(
      resolveOrigin({ configured: 'https://reservas.barberia.com.ar', host: 'localhost:3000' })
    ).toBe('https://reservas.barberia.com.ar');
  });

  it('trims a trailing slash off the configured origin', () => {
    // Otherwise the composed link carries a double slash before /b/, which looks
    // broken on a value the owner is about to copy and share.
    expect(resolveOrigin({ configured: 'https://barberia.com.ar/', host: 'x' })).toBe(
      'https://barberia.com.ar'
    );
  });

  it('falls back to the request host over https', () => {
    expect(resolveOrigin({ host: 'reservas.barberia.com.ar' })).toBe(
      'https://reservas.barberia.com.ar'
    );
  });

  it('honours a forwarded protocol', () => {
    expect(resolveOrigin({ host: 'localhost:3000', forwardedProto: 'http' })).toBe(
      'http://localhost:3000'
    );
  });

  it('takes the first protocol when several are forwarded', () => {
    // Proxy chains append, so the header can be "https,http". The first entry is
    // the one the client actually used.
    expect(resolveOrigin({ host: 'x.com', forwardedProto: 'https,http' })).toBe('https://x.com');
  });

  it('defaults localhost to http so the copied link works in development', () => {
    expect(resolveOrigin({ host: 'localhost:3000' })).toBe('http://localhost:3000');
    expect(resolveOrigin({ host: '127.0.0.1:3000' })).toBe('http://127.0.0.1:3000');
  });

  it('ignores a protocol it does not recognize', () => {
    expect(resolveOrigin({ host: 'x.com', forwardedProto: 'gopher' })).toBe('https://x.com');
  });

  it('returns null when there is nothing to build an origin from', () => {
    // Better than guessing: the editor shows the path and says the link is not
    // available yet, rather than handing the owner a URL to the wrong host.
    expect(resolveOrigin({})).toBeNull();
    expect(resolveOrigin({ host: '' })).toBeNull();
  });

  it('ignores a configured value that is not a usable origin', () => {
    expect(resolveOrigin({ configured: 'not a url', host: 'x.com' })).toBe('https://x.com');
  });
});
