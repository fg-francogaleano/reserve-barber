import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { COPY } from '@/lib/copy';
import PublicProfileErrorBoundary from './error';

/**
 * The other half of failing closed.
 *
 * `page.test.tsx` proves the booking route **propagates** a failed availability
 * read rather than rendering an empty or partial slot list. What propagation is
 * worth depends entirely on what the client then sees, and this boundary is what
 * they see — for `/b/{slug}` and, by nesting, for `/b/{slug}/reservar`.
 *
 * B2 required that coverage of the nested segment be verified rather than
 * assumed. It was verified by hand then; this is the assertion that keeps it
 * true, and it is the reason this file exists in B3 rather than B1.
 */

const reset = vi.fn();

function boundary(error: Error & { digest?: string }) {
  return <PublicProfileErrorBoundary error={error} reset={reset} />;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('PublicProfileErrorBoundary - what a stranger sees when a read fails', () => {
  it('should_render_the_spanish_error_state_with_a_retry_control', () => {
    render(boundary(new Error('connection lost')));

    expect(
      screen.getByRole('heading', { name: COPY.publicProfile.errorHeading })
    ).toBeInTheDocument();
    expect(screen.getByText(COPY.publicProfile.errorBody)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY.publicProfile.retry })).toBeInTheDocument();
  });

  it('should_never_show_the_error_message_to_the_client', () => {
    // The message is the one field that can carry a connection string, a SQL
    // statement or a schema name. The client is a stranger who opened a link
    // from a WhatsApp thread.
    const { container } = render(
      boundary(
        new Error('relation "Booking" does not exist: SELECT "startTime" FROM "Booking" WHERE ...')
      )
    );

    expect(container.innerHTML).not.toMatch(/Booking|startTime|SELECT|relation/);
  });

  it('should_leak_no_connection_detail_from_a_driver_error', () => {
    // The URL is deliberately unusable — `example.invalid` can never resolve —
    // so that a secret scanner reading this file finds a fixture rather than
    // something that looks like a credential. What is under test is the shape
    // of a driver error, not any real destination.
    const { container } = render(
      boundary(
        new Error('connect ECONNREFUSED postgresql://REDACTED@db.example.invalid:5432/postgres')
      )
    );

    expect(container.innerHTML).not.toMatch(
      /postgresql:\/\/|ECONNREFUSED|example\.invalid|5432|REDACTED/
    );
  });

  it('should_render_no_english_technical_text', () => {
    const { container } = render(boundary(new Error('connection lost')));

    expect(container.innerHTML).not.toMatch(
      /error:|stack|Error:|undefined|null|failed|exception/i
    );
  });

  it('should_correlate_with_the_server_log_through_the_digest_alone', () => {
    // A client boundary cannot import the server-only logger, so the digest is
    // the only thread back to the server-side entry. It must be the only thing
    // that travels.
    render(boundary(Object.assign(new Error('connection lost'), { digest: 'abc123' })));

    expect(console.error).toHaveBeenCalledTimes(1);
    const logged = vi.mocked(console.error).mock.calls[0]![0] as string;
    expect(JSON.parse(logged)).toEqual({
      level: 'error',
      message: 'Unhandled error reached the public profile boundary',
      digest: 'abc123',
    });
    expect(logged).not.toContain('connection lost');
  });

  it('should_log_a_null_digest_rather_than_omitting_it', () => {
    render(boundary(new Error('connection lost')));

    const logged = vi.mocked(console.error).mock.calls[0]![0] as string;
    expect(JSON.parse(logged).digest).toBeNull();
  });
});
