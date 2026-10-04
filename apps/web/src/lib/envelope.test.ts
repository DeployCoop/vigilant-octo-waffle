import { describe, it, expect } from 'vitest';
import { apiErrorMessage, codeForStatus, errorBody } from './envelope';

describe('errorBody', () => {
  it('builds the envelope, omitting reason when absent', () => {
    expect(errorBody('bad_request', 'Nope')).toEqual({
      error: { code: 'bad_request', message: 'Nope' },
    });
    expect(errorBody('forbidden', 'Denied', 'deny_missing_grant')).toEqual({
      error: {
        code: 'forbidden',
        message: 'Denied',
        reason: 'deny_missing_grant',
      },
    });
  });
});

describe('codeForStatus', () => {
  it('maps the stable vocabulary', () => {
    expect(codeForStatus(400)).toBe('bad_request');
    expect(codeForStatus(401)).toBe('unauthenticated');
    expect(codeForStatus(403)).toBe('forbidden');
    expect(codeForStatus(404)).toBe('not_found');
    expect(codeForStatus(409)).toBe('conflict');
    expect(codeForStatus(500)).toBe('internal');
    expect(codeForStatus(502)).toBe('internal');
    expect(codeForStatus(418)).toBe('error');
  });
});

describe('apiErrorMessage', () => {
  it('reads the envelope shape', () => {
    expect(
      apiErrorMessage({ error: { code: 'forbidden', message: 'Denied' } })
    ).toBe('Denied');
  });

  it('reads the legacy string shape', () => {
    expect(apiErrorMessage({ error: 'boom' })).toBe('boom');
  });

  it('falls back for empty or malformed bodies', () => {
    expect(apiErrorMessage({}, 'fb')).toBe('fb');
    expect(apiErrorMessage(null, 'fb')).toBe('fb');
    expect(apiErrorMessage({ error: { code: 'x' } }, 'fb')).toBe('fb');
    expect(apiErrorMessage({ error: '' }, 'fb')).toBe('fb');
  });
});
