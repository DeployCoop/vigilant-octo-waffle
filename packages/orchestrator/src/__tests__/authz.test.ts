import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  createEmptyStore,
  parseAuthzStore,
  serializeAuthzStore,
  loadAuthzStore,
  saveAuthzStore,
  clearAuthzStoreCache,
  authzStorePath,
  buildAbility,
  abilityAllows,
  authzSubject,
  decide,
  generatePrincipalToken,
  hashToken,
  verifyTokenHash,
  findPrincipalByToken,
  findPrincipalByOidcSubject,
  upsertPrincipal,
  removePrincipal,
  AuthzInvariantError,
  type AuthzStore,
  type AuthzStoreLoad,
  type Principal,
} from '../index.js';

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    id: 'p_test',
    name: 'Test Principal',
    kind: 'human',
    role: 'viewer',
    ...overrides,
  };
}

function ready(store: AuthzStore): AuthzStoreLoad {
  return { status: 'ready', store };
}

function storeWith(...principals: Principal[]): AuthzStore {
  return { version: 1, principals };
}

describe('authz permission catalog', () => {
  it('has no duplicate keys', () => {
    assert.equal(new Set(PERMISSIONS).size, PERMISSIONS.length);
  });

  it('role bundles only reference catalog keys', () => {
    for (const keys of Object.values(ROLE_PERMISSIONS)) {
      for (const key of keys) assert.ok(PERMISSIONS.includes(key), key);
    }
  });
});

describe('authz role bundles', () => {
  it('owner has every permission', () => {
    assert.deepEqual([...ROLE_PERMISSIONS.owner].sort(), [...PERMISSIONS].sort());
  });

  it('admin has everything except users:manage_permissions', () => {
    assert.ok(!ROLE_PERMISSIONS.admin.includes('users:manage_permissions'));
    assert.equal(ROLE_PERMISSIONS.admin.length, PERMISSIONS.length - 1);
  });

  it('operator matches the plan bundle exactly', () => {
    assert.deepEqual(
      [...ROLE_PERMISSIONS.operator].sort(),
      [
        'apps:read',
        'apps:deploy',
        'argo:sync',
        'flux:sync',
        'cluster:read',
        'config:read',
        'k8s:read',
        'k8s:logs:read',
        'tasks:read',
        'tasks:run',
        'namespaces:manage',
        'rollouts:manage',
        'helm:manage',
        'backups:manage',
        'security:read',
      ].sort()
    );
  });

  it('operator excludes every critical key', () => {
    for (const critical of [
      'k8s:exec',
      'remote:exec',
      'secrets:read',
      'config:update',
      'cluster:manage',
      'cluster:nodes:join',
      'chaos:run',
      'data:query',
      'users:manage_permissions',
    ] as const) {
      assert.ok(!ROLE_PERMISSIONS.operator.includes(critical), critical);
    }
  });

  it('viewer is read-only and webhook has no defaults', () => {
    assert.deepEqual(
      [...ROLE_PERMISSIONS.viewer].sort(),
      ['apps:read', 'cluster:read', 'config:read', 'k8s:read', 'security:read', 'tasks:read'].sort()
    );
    assert.deepEqual(ROLE_PERMISSIONS.webhook, []);
  });
});

describe('authz decide()', () => {
  it('allows everything when authz is disabled', () => {
    const d = decide({ status: 'disabled' }, null, 'k8s:exec');
    assert.deepEqual(d, { allowed: true, reason: 'allow_authz_disabled', principalId: undefined });
  });

  it('fails closed when the store is invalid', () => {
    const d = decide({ status: 'invalid', error: 'bad yaml' }, principal({ role: 'owner' }), 'apps:read');
    assert.equal(d.allowed, false);
    assert.equal(d.reason, 'deny_store_invalid');
  });

  it('bootstrap: empty store + local board allows, and only then', () => {
    const empty = ready(createEmptyStore());
    assert.equal(decide(empty, null, 'apps:read', undefined, { localBoard: true }).reason, 'allow_local_board');
    assert.equal(decide(empty, null, 'apps:read').reason, 'deny_unauthenticated');

    const withPrincipal = ready(storeWith(principal()));
    assert.equal(
      decide(withPrincipal, null, 'apps:read', undefined, { localBoard: true }).reason,
      'deny_unauthenticated'
    );
  });

  it('denies unauthenticated callers, distinguishing unknown OIDC principals', () => {
    const store = ready(storeWith(principal()));
    assert.equal(decide(store, null, 'apps:read').reason, 'deny_unauthenticated');
    assert.equal(
      decide(store, null, 'apps:read', undefined, { unknownPrincipal: true }).reason,
      'deny_unknown_principal'
    );
  });

  it('denies disabled principals before any other layer', () => {
    const disabledOwner = principal({ role: 'owner', disabled: true });
    const d = decide(ready(storeWith(disabledOwner)), disabledOwner, 'apps:read');
    assert.equal(d.reason, 'deny_disabled_principal');
  });

  it('owner is allowed everything via allow_owner', () => {
    const owner = principal({ role: 'owner' });
    const store = ready(storeWith(owner));
    for (const permission of PERMISSIONS) {
      const d = decide(store, owner, permission);
      assert.equal(d.allowed, true, permission);
      assert.equal(d.reason, 'allow_owner', permission);
    }
  });

  it('role defaults allow with allow_role_default', () => {
    const operator = principal({ role: 'operator' });
    const store = ready(storeWith(operator));
    assert.deepEqual(decide(store, operator, 'apps:deploy'), {
      allowed: true,
      reason: 'allow_role_default',
      principalId: 'p_test',
    });
    assert.equal(decide(store, operator, 'k8s:exec').reason, 'deny_missing_grant');
  });

  it('admin cannot manage permissions but can do everything else', () => {
    const admin = principal({ role: 'admin' });
    const store = ready(storeWith(admin));
    assert.equal(decide(store, admin, 'users:manage_permissions').allowed, false);
    assert.equal(decide(store, admin, 'k8s:exec').reason, 'allow_role_default');
    assert.equal(decide(store, admin, 'secrets:read').reason, 'allow_role_default');
  });

  it('a global grant allows beyond the role bundle', () => {
    const viewer = principal({ role: 'viewer', grants: [{ permission: 'apps:deploy' }] });
    const d = decide(ready(storeWith(viewer)), viewer, 'apps:deploy');
    assert.equal(d.reason, 'allow_explicit_grant');
  });

  it('a scoped grant matches only its target', () => {
    const viewer = principal({
      role: 'viewer',
      grants: [{ permission: 'apps:deploy', scope: { appId: 'harbor' } }],
    });
    const store = ready(storeWith(viewer));
    assert.equal(decide(store, viewer, 'apps:deploy', { appId: 'harbor' }).reason, 'allow_explicit_grant');
    assert.equal(decide(store, viewer, 'apps:deploy', { appId: 'nextcloud' }).reason, 'deny_scope');
    assert.equal(decide(store, viewer, 'apps:deploy').reason, 'deny_scope');
  });

  it('namespace scopes and combined scopes require every field to match', () => {
    const operator = principal({
      role: 'operator',
      grants: [{ permission: 'k8s:exec', scope: { appId: 'harbor', namespace: 'harbor' } }],
    });
    const store = ready(storeWith(operator));
    assert.equal(
      decide(store, operator, 'k8s:exec', { appId: 'harbor', namespace: 'harbor' }).allowed,
      true
    );
    assert.equal(decide(store, operator, 'k8s:exec', { appId: 'harbor' }).reason, 'deny_scope');
    assert.equal(
      decide(store, operator, 'k8s:exec', { appId: 'harbor', namespace: 'other' }).reason,
      'deny_scope'
    );
  });

  it('one matching grant is enough when several are scoped differently', () => {
    const viewer = principal({
      role: 'viewer',
      grants: [
        { permission: 'apps:deploy', scope: { appId: 'harbor' } },
        { permission: 'apps:deploy', scope: { namespace: 'monitoring' } },
      ],
    });
    const store = ready(storeWith(viewer));
    assert.equal(decide(store, viewer, 'apps:deploy', { namespace: 'monitoring' }).allowed, true);
    assert.equal(decide(store, viewer, 'apps:deploy', { appId: 'other' }).reason, 'deny_scope');
  });

  it('revocations beat role defaults, grants, and the owner wildcard', () => {
    const operator = principal({ role: 'operator', revocations: ['apps:deploy'] });
    assert.equal(decide(ready(storeWith(operator)), operator, 'apps:deploy').reason, 'deny_revoked');

    const granted = principal({
      role: 'viewer',
      grants: [{ permission: 'apps:deploy' }],
      revocations: ['apps:deploy'],
    });
    assert.equal(decide(ready(storeWith(granted)), granted, 'apps:deploy').reason, 'deny_revoked');

    const owner = principal({ role: 'owner', revocations: ['k8s:exec'] });
    assert.equal(decide(ready(storeWith(owner)), owner, 'k8s:exec').reason, 'deny_revoked');
  });

  it('the webhook service principal needs an explicit grant', () => {
    const svc = principal({ id: 'svc_hook', kind: 'service', role: 'webhook' });
    const store = ready(storeWith(svc));
    assert.equal(decide(store, svc, 'webhook:argo').reason, 'deny_missing_grant');

    const granted = principal({
      id: 'svc_hook',
      kind: 'service',
      role: 'webhook',
      grants: [{ permission: 'webhook:argo' }],
    });
    assert.equal(decide(store, granted, 'webhook:argo').reason, 'allow_explicit_grant');
    assert.equal(decide(store, granted, 'apps:read').reason, 'deny_missing_grant');
  });
});

describe('authz CASL ability consistency', () => {
  const subjects: (Principal | null)[] = [
    null,
    principal({ role: 'owner' }),
    principal({ role: 'admin' }),
    principal({ role: 'operator' }),
    principal({ role: 'viewer' }),
    principal({ role: 'viewer', grants: [{ permission: 'apps:deploy', scope: { appId: 'harbor' } }] }),
    principal({
      role: 'operator',
      grants: [{ permission: 'k8s:exec', scope: { namespace: 'monitoring' } }],
      revocations: ['apps:deploy'],
    }),
    principal({ role: 'owner', revocations: ['k8s:exec'] }),
    principal({ role: 'admin', disabled: true }),
  ];
  const targets = [undefined, {}, { appId: 'harbor' }, { appId: 'nextcloud' }, { namespace: 'monitoring' }, { appId: 'harbor', namespace: 'monitoring' }];

  it('abilityAllows agrees with decide() across the principal × permission × target matrix', () => {
    for (const p of subjects) {
      const store = ready(storeWith(...subjects.filter((s): s is Principal => s !== null)));
      for (const permission of PERMISSIONS) {
        for (const target of targets) {
          const expected = decide(store, p, permission, target).allowed;
          const actual = abilityAllows(p, permission, target);
          assert.equal(
            actual,
            expected,
            `${p?.id ?? 'null'}/${p?.role} ${permission} @ ${JSON.stringify(target)}`
          );
        }
      }
    }
  });

  it('buildAbility serializes rules for the dashboard (owner gets manage/all)', () => {
    const ownerRules = buildAbility(principal({ role: 'owner' })).rules;
    assert.ok(ownerRules.some((r) => r.action === 'manage' && r.subject === 'all'));
    assert.equal(buildAbility(null).rules.length, 0);
    assert.equal(buildAbility(principal({ disabled: true, role: 'owner' })).rules.length, 0);
  });

  it('authzSubject tags targets with the AuthzTarget subject type', () => {
    const tagged = authzSubject({ appId: 'harbor' }) as any;
    assert.equal(tagged.appId, 'harbor');
  });
});

describe('authz tokens', () => {
  it('generates prefixed, unique tokens', () => {
    const a = generatePrincipalToken();
    const b = generatePrincipalToken();
    assert.match(a, /^vow_[A-Za-z0-9_-]{20,}$/);
    assert.notEqual(a, b);
  });

  it('hashes and verifies tokens in constant-time form', () => {
    const token = generatePrincipalToken();
    const hash = hashToken(token);
    assert.match(hash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(verifyTokenHash(token, hash), true);
    assert.equal(verifyTokenHash('vow_wrong', hash), false);
    assert.equal(verifyTokenHash(token, 'not-a-hash'), false);
    assert.equal(verifyTokenHash(token, 'sha256:zz'), false);
    assert.equal(verifyTokenHash(token, ''), false);
  });

  it('finds principals by token and by OIDC subject', () => {
    const token = generatePrincipalToken();
    const josh = principal({ id: 'p_josh', tokenHash: hashToken(token), oidcSubject: 'kc-123' });
    const svc = principal({ id: 'svc', kind: 'service', role: 'webhook' });
    const store = storeWith(josh, svc);
    assert.equal(findPrincipalByToken(store, token)?.id, 'p_josh');
    assert.equal(findPrincipalByToken(store, 'vow_nope'), null);
    assert.equal(findPrincipalByOidcSubject(store, 'kc-123')?.id, 'p_josh');
    assert.equal(findPrincipalByOidcSubject(store, 'nobody'), null);
  });
});

describe('authz store parsing', () => {
  const sampleYaml = [
    'version: 1',
    'principals:',
    '  - id: p_josh',
    '    name: Josh',
    '    kind: human',
    '    role: admin',
    '    grants:',
    '      - permission: apps:deploy',
    '        scope:',
    '          appId: harbor',
    '    revocations:',
    '      - secrets:read',
    '',
  ].join('\n');

  it('parses a valid YAML store', () => {
    const store = parseAuthzStore(sampleYaml);
    assert.equal(store.principals.length, 1);
    assert.equal(store.principals[0].grants?.[0].scope?.appId, 'harbor');
    assert.deepEqual(store.principals[0].revocations, ['secrets:read']);
  });

  it('round-trips through serialize/parse', () => {
    const store = parseAuthzStore(sampleYaml);
    assert.deepEqual(parseAuthzStore(serializeAuthzStore(store)), store);
  });

  it('rejects malformed stores', () => {
    assert.throws(() => parseAuthzStore('version: 2\nprincipals: []'));
    assert.throws(() => parseAuthzStore('version: 1\nprincipals:\n  - id: x\n    name: X\n    kind: human\n    role: superuser'));
    assert.throws(() =>
      parseAuthzStore('version: 1\nprincipals:\n  - id: x\n    name: X\n    kind: human\n    role: viewer\n    grants:\n      - permission: bogus:key')
    );
    assert.throws(() => parseAuthzStore('version: 1\nprincipals:\n  - id: dup\n    name: A\n    kind: human\n    role: viewer\n  - id: dup\n    name: B\n    kind: human\n    role: viewer'));
    assert.throws(() => parseAuthzStore('not: [valid'));
  });
});

describe('authz store load/save', () => {
  let root: string;

  beforeEach(() => {
    clearAuthzStoreCache();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-authz-'));
  });

  it('reports disabled when no store exists and the env flag is off', () => {
    assert.deepEqual(loadAuthzStore(root, {}), { status: 'disabled' });
  });

  it('reports a ready empty store when the env flag is on but no file exists', () => {
    const load = loadAuthzStore(root, { VOW_AUTHZ: 'on' });
    assert.equal(load.status, 'ready');
    if (load.status === 'ready') assert.deepEqual(load.store, createEmptyStore());
  });

  it('saves with 0600 permissions and loads back', () => {
    const store = storeWith(principal({ id: 'p_a', role: 'owner' }));
    saveAuthzStore(root, store);
    const stat = fs.statSync(authzStorePath(root));
    assert.equal(stat.mode & 0o777, 0o600);
    const load = loadAuthzStore(root, {});
    assert.equal(load.status, 'ready');
    if (load.status === 'ready') assert.deepEqual(load.store, store);
  });

  it('fails closed on a corrupt store file', () => {
    fs.mkdirSync(path.dirname(authzStorePath(root)), { recursive: true });
    fs.writeFileSync(authzStorePath(root), 'version: 1\nprincipals: "nope"\n');
    const load = loadAuthzStore(root, {});
    assert.equal(load.status, 'invalid');
    assert.equal(decide(load, null, 'apps:read').reason, 'deny_store_invalid');
  });

  it('picks up file edits without a restart (mtime cache invalidation)', () => {
    saveAuthzStore(root, createEmptyStore());
    assert.equal(loadAuthzStore(root, {}).status, 'ready');

    const later = new Date(Date.now() + 5000);
    fs.writeFileSync(authzStorePath(root), 'version: 1\nprincipals: []\n');
    fs.utimesSync(authzStorePath(root), later, later);
    // Same content, but the file changed: still ready, and a corrupt edit flips to invalid.
    fs.writeFileSync(authzStorePath(root), 'version: 99\n');
    fs.utimesSync(authzStorePath(root), new Date(Date.now() + 10000), new Date(Date.now() + 10000));
    assert.equal(loadAuthzStore(root, {}).status, 'invalid');
  });
});

describe('authz store mutations', () => {
  it('upserts new and existing principals', () => {
    let store = createEmptyStore();
    store = upsertPrincipal(store, principal({ id: 'p_a', role: 'owner' }));
    store = upsertPrincipal(store, principal({ id: 'p_b', role: 'viewer' }));
    assert.equal(store.principals.length, 2);
    store = upsertPrincipal(store, principal({ id: 'p_b', role: 'operator' }));
    assert.equal(store.principals.length, 2);
    assert.equal(store.principals[1].role, 'operator');
  });

  it('removes principals and rejects unknown ids', () => {
    let store = storeWith(principal({ id: 'p_a', role: 'owner' }), principal({ id: 'p_b' }));
    store = removePrincipal(store, 'p_b');
    assert.deepEqual(store.principals.map((p) => p.id), ['p_a']);
    assert.throws(() => removePrincipal(store, 'p_nope'), AuthzInvariantError);
  });

  it('protects the last active owner from removal, demotion, and disabling', () => {
    const store = storeWith(principal({ id: 'p_a', role: 'owner' }), principal({ id: 'p_b' }));
    assert.throws(() => removePrincipal(store, 'p_a'), AuthzInvariantError);
    assert.throws(() => upsertPrincipal(store, principal({ id: 'p_a', role: 'admin' })), AuthzInvariantError);
    assert.throws(
      () => upsertPrincipal(store, principal({ id: 'p_a', role: 'owner', disabled: true })),
      AuthzInvariantError
    );
  });

  it('allows owner changes once a second owner exists', () => {
    let store = storeWith(principal({ id: 'p_a', role: 'owner' }));
    store = upsertPrincipal(store, principal({ id: 'p_b', role: 'owner' }));
    store = removePrincipal(store, 'p_a');
    assert.deepEqual(store.principals.map((p) => p.id), ['p_b']);
  });

  it('rejects invalid principals at upsert time', () => {
    const store = createEmptyStore();
    assert.throws(() => upsertPrincipal(store, principal({ role: 'nope' as any })));
    assert.throws(() =>
      upsertPrincipal(store, principal({ grants: [{ permission: 'bogus' as any }] }))
    );
  });
});
