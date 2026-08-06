import { describe, it, expect } from 'vitest';
import { getSafeRedirectTarget } from './isSafeRedirect';

const DASHBOARD_HOME = '/';

describe('getSafeRedirectTarget', () => {
  it('should_accept_a_relative_path', () => {
    expect(getSafeRedirectTarget('/servicios', DASHBOARD_HOME)).toBe('/servicios');
  });

  it('should_accept_a_relative_path_with_query_string', () => {
    expect(getSafeRedirectTarget('/clientes?tab=activos', DASHBOARD_HOME)).toBe('/clientes?tab=activos');
  });

  it('should_reject_a_protocol_relative_path', () => {
    expect(getSafeRedirectTarget('//evil.com', DASHBOARD_HOME)).toBe(DASHBOARD_HOME);
  });

  it('should_reject_an_absolute_url', () => {
    expect(getSafeRedirectTarget('https://evil.com', DASHBOARD_HOME)).toBe(DASHBOARD_HOME);
  });

  it('should_reject_a_path_not_starting_with_a_slash', () => {
    expect(getSafeRedirectTarget('evil.com', DASHBOARD_HOME)).toBe(DASHBOARD_HOME);
  });

  it('should_reject_a_backslash_variant', () => {
    expect(getSafeRedirectTarget('/\\evil.com', DASHBOARD_HOME)).toBe(DASHBOARD_HOME);
  });

  it('should_reject_a_bare_backslash_prefix', () => {
    expect(getSafeRedirectTarget('\\\\evil.com', DASHBOARD_HOME)).toBe(DASHBOARD_HOME);
  });

  it('should_reject_a_percent_encoded_protocol_relative_path', () => {
    expect(getSafeRedirectTarget('/%2F%2Fevil.com', DASHBOARD_HOME)).toBe(DASHBOARD_HOME);
  });

  it('should_reject_a_percent_encoded_backslash', () => {
    expect(getSafeRedirectTarget('/%5Cevil.com', DASHBOARD_HOME)).toBe(DASHBOARD_HOME);
  });

  it('should_fall_back_to_the_dashboard_home_for_empty_input', () => {
    expect(getSafeRedirectTarget('', DASHBOARD_HOME)).toBe(DASHBOARD_HOME);
  });

  it('should_fall_back_to_the_dashboard_home_for_null_input', () => {
    expect(getSafeRedirectTarget(null, DASHBOARD_HOME)).toBe(DASHBOARD_HOME);
  });

  it('should_fall_back_to_the_dashboard_home_for_undefined_input', () => {
    expect(getSafeRedirectTarget(undefined, DASHBOARD_HOME)).toBe(DASHBOARD_HOME);
  });

  it('should_reject_malformed_percent_encoding_instead_of_throwing', () => {
    expect(getSafeRedirectTarget('/%', DASHBOARD_HOME)).toBe(DASHBOARD_HOME);
  });
});
