import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  escapeLdapFilter,
  escapeLdapDnValue,
  resolveVowRoleFromLdapGroups,
  resolveVowLdapConfig,
  authenticateVowLdapUser,
  berDecodeElement,
  berDecodeChildren,
  berDecodeInt,
  berEncodeSequence,
  berEncodeInteger,
  berEncodeEnumerated,
  berEncodeOctetString,
  findPrincipalByLdapUid,
  syncLdapPrincipal,
  createEmptyStore,
  parseAuthzStore,
  serializeAuthzStore,
  type LdapSocketLike,
  type LdapTransportFactory,
  type Principal,
} from '../index.js';

class MockLdapSocket extends EventEmitter implements LdapSocketLike {
  constructor(private handler: (msgId: number, opTag: number, opPayload: Buffer, push: (pkt: Buffer) => void) => void) {
    super();
  }

  write(data: Uint8Array | Buffer): boolean {
    const buf = Buffer.from(data);
    const el = berDecodeElement(buf, 0);
    if (!el) return true;
    const children = berDecodeChildren(el.value);
    if (children.length < 2) return true;
    const msgId = berDecodeInt(children[0].value);
    const op = children[1];
    queueMicrotask(() => {
      this.handler(msgId, op.tag, op.value, (pkt) => this.emit('data', pkt));
    });
    return true;
  }

  end(): this {
    return this;
  }

  destroy(): this {
    return this;
  }
}

function encodeBindResponse(msgId: number, resultCode: number, diagnostic = ''): Buffer {
  const res = berEncodeSequence(
    [
      berEncodeEnumerated(resultCode),
      berEncodeOctetString(''),
      berEncodeOctetString(diagnostic),
    ],
    0x61 // BindResponse
  );
  return berEncodeSequence([berEncodeInteger(msgId), res]);
}

function encodeSearchEntry(msgId: number, dn: string, attrs: Record<string, string[]>): Buffer {
  const attrList = Object.entries(attrs).map(([k, vals]) =>
    berEncodeSequence([
      berEncodeOctetString(k),
      berEncodeSequence(vals.map((v) => berEncodeOctetString(v)), 0x31),
    ])
  );
  const entry = berEncodeSequence(
    [berEncodeOctetString(dn), berEncodeSequence(attrList)],
    0x64 // SearchResultEntry
  );
  return berEncodeSequence([berEncodeInteger(msgId), entry]);
}

function encodeSearchDone(msgId: number, resultCode = 0): Buffer {
  const done = berEncodeSequence(
    [berEncodeEnumerated(resultCode), berEncodeOctetString(''), berEncodeOctetString('')],
    0x65 // SearchResultDone
  );
  return berEncodeSequence([berEncodeInteger(msgId), done]);
}

describe('authz-ldap RFC 4515 / RFC 4514 escaping', () => {
  it('escapes special filter characters per RFC 4515', () => {
    assert.equal(escapeLdapFilter('alice'), 'alice');
    assert.equal(escapeLdapFilter('admin)(|(uid=*'), 'admin\\29\\28|\\28uid=\\2a');
    assert.equal(escapeLdapFilter('a\\b\0c'), 'a\\5cb\\00c');
  });

  it('escapes special DN characters per RFC 4514', () => {
    assert.equal(escapeLdapDnValue('alice'), 'alice');
    assert.equal(escapeLdapDnValue('#lead,plus+quote"end '), '\\#lead\\,plus\\+quote\\"end\\ ');
  });
});

describe('authz-ldap POSIX group to CASL role mapping', () => {
  it('maps groups in highest-privilege order (owner -> admin -> operator -> viewer -> default)', () => {
    assert.equal(
      resolveVowRoleFromLdapGroups(['axonwall-readonly', 'axonwall-admin']),
      'owner'
    );
    assert.equal(
      resolveVowRoleFromLdapGroups(['vow-readonly', 'vow-admin']),
      'admin'
    );
    assert.equal(
      resolveVowRoleFromLdapGroups(['vow-operator', 'axonwall-readonly']),
      'operator'
    );
    assert.equal(
      resolveVowRoleFromLdapGroups(['vow-readonly']),
      'viewer'
    );
    assert.equal(
      resolveVowRoleFromLdapGroups(['unmapped-group'], { defaultRole: 'none' }),
      'none'
    );
  });
});

describe('authz-ldap Axonwall plugin binding auto-discovery', () => {
  it('auto-discovers /etc/axonwall/ldap-plugins/vigilant-octo-waffle.json contract', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-ldap-binding-'));
    const bindingPath = path.join(tmpDir, 'vigilant-octo-waffle.json');
    fs.writeFileSync(
      bindingPath,
      JSON.stringify({
        pluginId: 'vigilant-octo-waffle',
        enabled: true,
        url: 'ldap://127.0.0.1:389',
        baseDn: 'dc=edge,dc=axonwall,dc=local',
        bindDn: 'cn=svc-vow,ou=services,dc=edge,dc=axonwall,dc=local',
        bindPassword: 'secret-svc-password',
        userSearchBase: 'ou=users,dc=edge,dc=axonwall,dc=local',
        groupSearchBase: 'ou=groups,dc=edge,dc=axonwall,dc=local',
        roleGroups: {
          admin: ['axonwall-admin', 'vow-admin'],
          operator: ['axonwall-operator', 'vow-operator'],
          readonly: ['axonwall-readonly', 'vow-readonly'],
        },
      })
    );

    const cfg = resolveVowLdapConfig({
      env: {},
      bindingFileOverride: bindingPath,
    });
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.baseDn, 'dc=edge,dc=axonwall,dc=local');
    assert.equal(cfg.bindDn, 'cn=svc-vow,ou=services,dc=edge,dc=axonwall,dc=local');
    assert.equal(cfg.bindPassword, 'secret-svc-password');
    assert.deepEqual(cfg.adminGroups, ['axonwall-admin', 'vow-admin']);
    assert.deepEqual(cfg.operatorGroups, ['axonwall-operator', 'vow-operator']);
    assert.deepEqual(cfg.viewerGroups, ['axonwall-readonly', 'vow-readonly']);
  });
});

describe('authenticateVowLdapUser (LDAPv3 protocol flow)', () => {
  function createMockTransport(opts: {
    locked?: boolean;
    groups?: string[];
    validPassword?: string;
  } = {}): LdapTransportFactory {
    const expectedPass = opts.validPassword ?? 'CorrectHorse!1';
    let searchStep = 0;

    return async () =>
      new MockLdapSocket((msgId, opTag, opPayload, push) => {
        if (opTag === 0x60) {
          // BindRequest
          const parts = berDecodeChildren(opPayload);
          const dn = parts[1]?.value.toString('utf-8') ?? '';
          const pw = parts[2]?.value.toString('utf-8') ?? '';
          if (dn.startsWith('cn=svc-vow')) {
            push(encodeBindResponse(msgId, pw === 'svc-secret' ? 0 : 49));
          } else if (dn === 'uid=alice,ou=users,dc=axonwall,dc=local') {
            push(encodeBindResponse(msgId, pw === expectedPass ? 0 : 49));
          } else {
            push(encodeBindResponse(msgId, 49));
          }
        } else if (opTag === 0x63) {
          // SearchRequest
          searchStep++;
          if (searchStep === 1) {
            push(
              encodeSearchEntry(msgId, 'uid=alice,ou=users,dc=axonwall,dc=local', {
                uid: ['alice'],
                cn: ['Alice Operator'],
                mail: ['alice@axonwall.local'],
                ...(opts.locked ? { pwdAccountLockedTime: ['20261101000000Z'] } : {}),
              })
            );
            push(encodeSearchDone(msgId, 0));
          } else {
            for (const g of opts.groups ?? ['vow-operator']) {
              push(
                encodeSearchEntry(msgId, `cn=${g},ou=groups,dc=axonwall,dc=local`, {
                  cn: [g],
                })
              );
            }
            push(encodeSearchDone(msgId, 0));
          }
        }
      });
  }

  const baseConfig = {
    enabled: true,
    url: 'ldap://127.0.0.1:389',
    baseDn: 'dc=axonwall,dc=local',
    bindDn: 'cn=svc-vow,ou=services,dc=axonwall,dc=local',
    bindPassword: 'svc-secret',
    userSearchBase: 'ou=users,dc=axonwall,dc=local',
    groupSearchBase: 'ou=groups,dc=axonwall,dc=local',
  };

  it('authenticates user, resolves POSIX groups, and maps to CASL role', async () => {
    const res = await authenticateVowLdapUser(
      'alice',
      'CorrectHorse!1',
      baseConfig,
      createMockTransport({ groups: ['vow-operator', 'axonwall-readonly'] })
    );
    assert.equal(res.authenticated, true);
    assert.equal(res.username, 'alice');
    assert.equal(res.displayName, 'Alice Operator');
    assert.equal(res.email, 'alice@axonwall.local');
    assert.equal(res.role, 'operator');
    assert.deepEqual(res.groups, ['vow-operator', 'axonwall-readonly']);
  });

  it('rejects wrong password with resultCode 49', async () => {
    const res = await authenticateVowLdapUser(
      'alice',
      'WrongPassword',
      baseConfig,
      createMockTransport({ groups: ['vow-admin'] })
    );
    assert.equal(res.authenticated, false);
    assert.match(res.error ?? '', /Invalid username or password/);
  });

  it('rejects locked OpenLDAP accounts (pwdAccountLockedTime)', async () => {
    const res = await authenticateVowLdapUser(
      'alice',
      'CorrectHorse!1',
      baseConfig,
      createMockTransport({ locked: true })
    );
    assert.equal(res.authenticated, false);
    assert.match(res.error ?? '', /locked/i);
  });

  it('denies unmapped directory users when defaultRole is none', async () => {
    const res = await authenticateVowLdapUser(
      'alice',
      'CorrectHorse!1',
      { ...baseConfig, defaultRole: 'none' },
      createMockTransport({ groups: ['unrelated-group'] })
    );
    assert.equal(res.authenticated, false);
    assert.match(res.error ?? '', /not a member of any authorized/i);
  });
});

describe('syncLdapPrincipal & store round-trip', () => {
  it('auto-provisions LDAP principal, preserves custom scoped grants on re-sync, and round-trips YAML', () => {
    const initial = createEmptyStore();
    const first = syncLdapPrincipal(initial, {
      username: 'alice',
      displayName: 'Alice',
      groups: ['vow-operator'],
      role: 'operator',
    });
    assert.ok(first.principal);
    assert.equal(first.principal.id, 'p_ldap_alice');
    assert.equal(first.principal.role, 'operator');
    assert.equal(first.principal.ldapUid, 'alice');
    assert.deepEqual(first.principal.ldapGroups, ['vow-operator']);

    // Attach a custom scoped grant to p_ldap_alice
    const withGrant: Principal = {
      ...first.principal,
      grants: [{ permission: 'k8s:exec', scope: { namespace: 'monitoring' } }],
    };
    const storeWithGrant = {
      ...first.store,
      principals: [withGrant],
      ldap: { enabled: true, url: 'ldap://127.0.0.1:389', baseDn: 'dc=axonwall,dc=local' },
    };

    // Re-sync when Alice gets promoted to vow-admin in OpenLDAP
    const second = syncLdapPrincipal(storeWithGrant, {
      username: 'alice',
      displayName: 'Alice Admin',
      groups: ['vow-admin'],
      role: 'admin',
    });
    assert.ok(second.principal);
    assert.equal(second.principal.role, 'admin');
    assert.deepEqual(second.principal.grants, [
      { permission: 'k8s:exec', scope: { namespace: 'monitoring' } },
    ]);
    assert.equal(findPrincipalByLdapUid(second.store, 'ALICE')?.id, 'p_ldap_alice');

    const yamlText = serializeAuthzStore(second.store);
    const parsed = parseAuthzStore(yamlText);
    assert.equal(parsed.ldap?.baseDn, 'dc=axonwall,dc=local');
    assert.equal(parsed.principals[0].ldapUid, 'alice');
  });

  it('rejects disabled principals and respects autoProvision=false', () => {
    const unprov = syncLdapPrincipal(
      createEmptyStore(),
      { username: 'bob', role: 'viewer' },
      { autoProvision: false }
    );
    assert.equal(unprov.principal, null);
    assert.equal(unprov.reason, 'unprovisioned');

    const disabledStore = {
      version: 1 as const,
      principals: [
        {
          id: 'p_ldap_bob',
          name: 'Bob',
          kind: 'human' as const,
          role: 'viewer' as const,
          ldapUid: 'bob',
          disabled: true,
        },
      ],
    };
    const dis = syncLdapPrincipal(disabledStore, { username: 'bob', role: 'admin' });
    assert.equal(dis.principal, null);
    assert.equal(dis.reason, 'disabled');
  });
});
