import { describe, it, expect } from 'vitest';
import { parseTransferDetails } from './transferDetailsSchema';

const VALID_CBU = '2850590940090418135201';
const VALID_ALIAS = 'mi.barberia';
const VALID_HOLDER = 'Barberia Franco';

function parse(overrides: Partial<Record<'cbuCvu' | 'alias' | 'holderName', unknown>> = {}) {
  return parseTransferDetails({
    cbuCvu: '',
    alias: '',
    holderName: '',
    ...overrides,
  });
}

describe('parseTransferDetails - unconfigured state', () => {
  it('should_accept_all_fields_empty', () => {
    const result = parse();
    expect(result).toEqual({
      ok: true,
      data: { cbuCvu: null, alias: null, holderName: null },
    });
  });

  it('should_treat_whitespace_only_input_as_unconfigured', () => {
    const result = parse({ cbuCvu: '   ', alias: '  ', holderName: '   ' });
    expect(result.ok).toBe(true);
  });

  it('should_treat_missing_fields_as_unconfigured', () => {
    // A crafted payload omitting the fields entirely must not crash.
    const result = parseTransferDetails({
      cbuCvu: undefined,
      alias: null,
      holderName: 42,
    });
    expect(result.ok).toBe(true);
  });
});

describe('parseTransferDetails - configured state', () => {
  it('should_accept_a_cbu_with_a_holder_name', () => {
    const result = parse({ cbuCvu: VALID_CBU, holderName: VALID_HOLDER });
    expect(result).toEqual({
      ok: true,
      data: { cbuCvu: VALID_CBU, alias: null, holderName: VALID_HOLDER },
    });
  });

  it('should_accept_an_alias_alone_with_a_holder_name', () => {
    const result = parse({ alias: VALID_ALIAS, holderName: VALID_HOLDER });
    expect(result).toEqual({
      ok: true,
      data: { cbuCvu: null, alias: VALID_ALIAS, holderName: VALID_HOLDER },
    });
  });

  it('should_accept_both_destinations_together', () => {
    const result = parse({ cbuCvu: VALID_CBU, alias: VALID_ALIAS, holderName: VALID_HOLDER });
    expect(result).toEqual({
      ok: true,
      data: { cbuCvu: VALID_CBU, alias: VALID_ALIAS, holderName: VALID_HOLDER },
    });
  });

  it('should_store_the_destination_normalized_not_as_typed', () => {
    const result = parse({
      cbuCvu: '2850 5909 4009 0418 1352 01',
      alias: '  MI.BARBERIA  ',
      holderName: '  Barberia   Franco ',
    });
    expect(result).toEqual({
      ok: true,
      data: { cbuCvu: VALID_CBU, alias: VALID_ALIAS, holderName: VALID_HOLDER },
    });
  });
});

describe('parseTransferDetails - invalid state', () => {
  it('should_reject_a_destination_without_a_holder_name', () => {
    const result = parse({ cbuCvu: VALID_CBU });
    expect(result).toEqual({
      ok: false,
      fieldErrors: { holderName: 'holder_required' },
    });
  });

  it('should_reject_an_alias_without_a_holder_name', () => {
    const result = parse({ alias: VALID_ALIAS });
    expect(result).toEqual({
      ok: false,
      fieldErrors: { holderName: 'holder_required' },
    });
  });

  it('should_reject_a_holder_name_with_no_destination', () => {
    const result = parse({ holderName: VALID_HOLDER });
    expect(result).toEqual({
      ok: false,
      fieldErrors: { form: 'no_destination' },
    });
  });

  it('should_report_a_failed_checksum_on_the_destination_field', () => {
    const transposed = `${VALID_CBU.slice(0, 4)}${VALID_CBU[5]}${VALID_CBU[4]}${VALID_CBU.slice(6)}`;
    const result = parse({ cbuCvu: transposed, holderName: VALID_HOLDER });
    expect(result).toEqual({
      ok: false,
      fieldErrors: { cbuCvu: 'invalid_checksum' },
    });
  });

  it('should_report_a_length_problem_distinctly_from_a_checksum_problem', () => {
    const result = parse({ cbuCvu: '123456', holderName: VALID_HOLDER });
    expect(result).toEqual({
      ok: false,
      fieldErrors: { cbuCvu: 'invalid_length' },
    });
  });

  it('should_report_a_malformed_destination_as_invalid_chars', () => {
    const result = parse({ cbuCvu: 'abcd', holderName: VALID_HOLDER });
    expect(result).toEqual({
      ok: false,
      fieldErrors: { cbuCvu: 'invalid_chars' },
    });
  });

  it('should_report_an_alias_that_is_too_short', () => {
    const result = parse({ alias: 'abc', holderName: VALID_HOLDER });
    expect(result).toEqual({
      ok: false,
      fieldErrors: { alias: 'invalid_length' },
    });
  });

  it('should_report_a_holder_name_containing_markup', () => {
    const result = parse({ cbuCvu: VALID_CBU, holderName: '<b>Franco</b>' });
    expect(result).toEqual({
      ok: false,
      fieldErrors: { holderName: 'invalid_chars' },
    });
  });

  it('should_report_every_bad_field_at_once_rather_than_the_first', () => {
    // An owner who mistyped two fields should not have to submit twice to
    // discover the second mistake.
    const result = parse({ cbuCvu: 'abcd', alias: 'x', holderName: VALID_HOLDER });
    expect(result).toEqual({
      ok: false,
      fieldErrors: { cbuCvu: 'invalid_chars', alias: 'invalid_length' },
    });
  });

  it('should_not_report_no_destination_when_a_destination_is_present_but_invalid', () => {
    // The owner did supply a destination; telling them they supplied none
    // would describe a different mistake than the one they made.
    const result = parse({ cbuCvu: 'abcd', holderName: VALID_HOLDER });
    if (result.ok) {
      throw new Error('expected rejection');
    }
    expect(result.fieldErrors.form).toBeUndefined();
  });

  it('should_reject_a_holder_name_that_normalizes_away_when_a_destination_is_given', () => {
    const result = parse({ cbuCvu: VALID_CBU, holderName: '​​' });
    expect(result).toEqual({
      ok: false,
      fieldErrors: { holderName: 'holder_required' },
    });
  });
});
