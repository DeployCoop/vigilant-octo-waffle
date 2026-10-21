import { describe, it, expect } from 'vitest';
import { serializeGrantForSave, formatGrantContext } from './access-grants';

describe('serializeGrantForSave', () => {
  it('preserves a grant context verbatim on save (Plan III §4.1 regression)', () => {
    const grant = {
      permission: 'apps:deploy',
      scope: { appId: 'web' },
      context: {
        notBefore: '2026-10-01T00:00:00.000Z',
        notAfter: '2026-12-31T00:00:00.000Z',
        source: 'loopback' as const,
        authMethod: 'session' as const,
      },
    };
    const out = serializeGrantForSave(grant);
    expect(out).toEqual(grant);
    // A copy, not the loaded object: later edits must not mutate it.
    expect(out.context).not.toBe(grant.context);
  });

  it('keeps a context even when the grant has no scope', () => {
    const out = serializeGrantForSave({
      permission: 'config:update',
      context: { source: 'loopback' },
    });
    expect(out).toEqual({
      permission: 'config:update',
      context: { source: 'loopback' },
    });
  });

  it('omits an absent or empty context', () => {
    expect(serializeGrantForSave({ permission: 'apps:read' })).toEqual({
      permission: 'apps:read',
    });
    expect(serializeGrantForSave({ permission: 'apps:read', context: {} })).toEqual({
      permission: 'apps:read',
    });
  });

  it('still trims scope fields and drops an empty scope', () => {
    expect(
      serializeGrantForSave({
        permission: 'apps:read',
        scope: { appId: '  web  ', namespace: ' ' },
      })
    ).toEqual({ permission: 'apps:read', scope: { appId: 'web' } });
    expect(serializeGrantForSave({ permission: 'apps:read', scope: {} })).toEqual({
      permission: 'apps:read',
    });
  });
});

describe('formatGrantContext', () => {
  it('renders the CLI-style summary, skipping unconstrained any values', () => {
    expect(
      formatGrantContext({
        source: 'loopback',
        authMethod: 'session',
        notAfter: '2026-12-31T00:00:00.000Z',
      })
    ).toBe('src=loopback auth=session until=2026-12-31T00:00:00.000Z');
    expect(formatGrantContext({ source: 'any', authMethod: 'any' })).toBe('');
  });

  it('renders a time window', () => {
    expect(
      formatGrantContext({
        notBefore: '2026-10-01T00:00:00.000Z',
        notAfter: '2026-10-31T00:00:00.000Z',
      })
    ).toBe('from=2026-10-01T00:00:00.000Z until=2026-10-31T00:00:00.000Z');
  });

  it('is empty for no context', () => {
    expect(formatGrantContext(undefined)).toBe('');
    expect(formatGrantContext({})).toBe('');
  });
});
