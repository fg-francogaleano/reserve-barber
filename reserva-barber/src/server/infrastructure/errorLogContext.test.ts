import { describe, it, expect } from 'vitest';
import { toErrorLogContext } from './errorLogContext';

/**
 * A real PostgreSQL unique violation, as Prisma surfaces it. The offending
 * values are embedded in the message — which is exactly why it must never be
 * logged verbatim (design D11).
 */
function uniqueViolation(): Error & { code: string } {
  return Object.assign(
    new Error(
      'Unique constraint failed on the fields: (`ownerId`,`name`)\n' +
        'Key (ownerId, name)=(owner-root, Corte Clásico) already exists.'
    ),
    { code: 'P2002' }
  );
}

describe('toErrorLogContext - recognized database violations', () => {
  it('should_record_the_code_and_the_operation', () => {
    const context = toErrorLogContext('createService', uniqueViolation());
    expect(context.operation).toBe('createService');
    expect(context.code).toBe('P2002');
  });

  it('should_not_record_the_driver_message', () => {
    const context = toErrorLogContext('createService', uniqueViolation());
    expect(context.cause).toBeUndefined();
  });

  it('should_not_leak_the_submitted_business_value', () => {
    const serialized = JSON.stringify(toErrorLogContext('createService', uniqueViolation()));
    expect(serialized).not.toContain('Corte Clásico');
    expect(serialized).not.toContain('owner-root');
    expect(serialized).not.toContain('Unique constraint');
  });

  it('should_not_allow_a_crafted_name_to_forge_log_fields', () => {
    // A name containing quotes and newlines would otherwise land inside the
    // structured log line through the driver message.
    const crafted = Object.assign(
      new Error('Key (ownerId, name)=(owner-root, ", "level": "info", "x": ") already exists.'),
      { code: 'P2002' }
    );
    const serialized = JSON.stringify(toErrorLogContext('createService', crafted));
    expect(serialized).not.toContain('"level": "info"');
  });

  it.each(['P2002', 'P2003', 'P2025', 'P2000'])(
    'should_recognize_%s_as_a_constraint_violation',
    (code) => {
      const context = toErrorLogContext('op', Object.assign(new Error('secret detail'), { code }));
      expect(context.code).toBe(code);
      expect(context.cause).toBeUndefined();
    }
  );
});

describe('toErrorLogContext - unrecognized failures', () => {
  it('should_keep_the_message_so_the_failure_can_be_diagnosed', () => {
    // Stripping the detail from an unknown failure makes it undiagnosable —
    // the opposite of the goal.
    const context = toErrorLogContext('createService', new Error('Connection terminated'));
    expect(context.cause).toBe('Connection terminated');
    expect(context.code).toBeUndefined();
  });

  it('should_keep_the_message_for_an_unknown_prisma_code', () => {
    const context = toErrorLogContext(
      'createService',
      Object.assign(new Error('Cannot reach database server'), { code: 'P1001' })
    );
    expect(context.cause).toBe('Cannot reach database server');
    expect(context.code).toBe('P1001');
  });

  it('should_handle_a_non_error_throw', () => {
    expect(toErrorLogContext('op', 'plain string').cause).toBe('plain string');
    expect(toErrorLogContext('op', undefined).cause).toBe('undefined');
  });
});
