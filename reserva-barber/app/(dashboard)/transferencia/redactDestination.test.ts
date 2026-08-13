import { describe, it, expect } from 'vitest';
import { redactDestination } from './redactDestination';

const CBU = '2850590940090418135201';

describe('redactDestination', () => {
  it('should_remove_the_destination_from_an_unrecognized_error_message', () => {
    const context = redactDestination(
      { operation: 'saveTransferDetails', cause: `insert failed for ${CBU}` },
      [CBU, null, null]
    );

    expect(context.cause).not.toContain(CBU);
    expect(context.cause).toContain('[redacted]');
  });

  it('should_keep_the_rest_of_the_message_so_the_failure_stays_diagnosable', () => {
    const context = redactDestination(
      { operation: 'saveTransferDetails', cause: `connection terminated while writing ${CBU}` },
      [CBU, null, null]
    );

    expect(context.cause).toContain('connection terminated while writing');
  });

  it('should_remove_every_occurrence', () => {
    const context = redactDestination(
      { operation: 'saveTransferDetails', cause: `${CBU} and again ${CBU}` },
      [CBU, null, null]
    );

    expect(context.cause).toBe('[redacted] and again [redacted]');
  });

  it('should_redact_the_alias_and_the_holder_name_too', () => {
    const context = redactDestination(
      { operation: 'saveTransferDetails', cause: 'failed for mi.barberia of Barberia Franco' },
      [null, 'mi.barberia', 'Barberia Franco']
    );

    expect(context.cause).not.toContain('mi.barberia');
    expect(context.cause).not.toContain('Barberia Franco');
  });

  it('should_leave_a_context_with_no_cause_untouched', () => {
    const context = redactDestination({ operation: 'saveTransferDetails', code: 'P2002' }, [CBU]);

    expect(context).toEqual({ operation: 'saveTransferDetails', code: 'P2002' });
  });

  it('should_not_blank_a_message_with_a_short_value', () => {
    // A three-character field would otherwise match everywhere and destroy the
    // message it is supposed to be sanitizing.
    const context = redactDestination(
      { operation: 'saveTransferDetails', cause: 'a connection error occurred' },
      ['a', 'on', 'err']
    );

    expect(context.cause).toBe('a connection error occurred');
  });

  it('should_preserve_the_operation_and_the_code', () => {
    const context = redactDestination(
      { operation: 'saveTransferDetails', code: 'P1001', cause: CBU },
      [CBU]
    );

    expect(context.operation).toBe('saveTransferDetails');
    expect(context.code).toBe('P1001');
  });
});
