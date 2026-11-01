import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import * as tls from 'node:tls';
import { EventEmitter } from 'node:events';
import type { Role } from './authz.js';

/**
 * Pure-TypeScript RFC 4511 LDAPv3 Authenticator & POSIX Group-to-CASL Role
 * Mapper for Vigilant Octo Waffle (`@vow/orchestrator`).
 *
 * Automatically discovers Axonwall's local OpenLDAP plugin binding contract
 * (`/etc/axonwall/ldap-plugins/vigilant-octo-waffle.json` or `/etc/axonwall/vow/ldap.json`),
 * `.vow/authz.yaml` `ldap` block, or `VOW_LDAP_*` environment variables.
 */

export const DEFAULT_AXONWALL_VOW_LDAP_BINDING_FILE =
  '/etc/axonwall/ldap-plugins/vigilant-octo-waffle.json';
export const FALLBACK_AXONWALL_VOW_LDAP_FILE = '/etc/axonwall/vow/ldap.json';

export type VowLdapRole = Exclude<Role, 'webhook'> | 'none';

export interface VowLdapConfig {
  enabled: boolean;
  url: string;
  baseDn: string;
  bindDn?: string;
  bindPassword?: string;
  userSearchBase: string;
  userSearchFilter: string;
  groupSearchBase: string;
  groupSearchFilter: string;
  ownerGroups: string[];
  adminGroups: string[];
  operatorGroups: string[];
  viewerGroups: string[];
  defaultRole: VowLdapRole;
  autoProvisionPrincipals: boolean;
  allowLocalBreakGlass: boolean;
  tlsRejectUnauthorized: boolean;
  connectTimeoutMs: number;
  bindingFile?: string;
}

export interface VowLdapAuthResult {
  authenticated: boolean;
  username?: string;
  displayName?: string;
  email?: string;
  dn?: string;
  groups?: string[];
  role?: Exclude<Role, 'webhook'>;
  error?: string;
}

export interface LdapSocketLike extends EventEmitter {
  write(data: Uint8Array | Buffer): boolean;
  end(): this | void;
  destroy(): this | void;
}

export type LdapTransportFactory = (
  url: URL,
  timeoutMs: number,
  tlsRejectUnauthorized: boolean
) => Promise<LdapSocketLike>;

/**
 * RFC 4515 LDAP search filter value escaping to prevent LDAP filter injection.
 */
export function escapeLdapFilter(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    switch (ch) {
      case '\\':
        out += '\\5c';
        break;
      case '*':
        out += '\\2a';
        break;
      case '(':
        out += '\\28';
        break;
      case ')':
        out += '\\29';
        break;
      case '\0':
        out += '\\00';
        break;
      default:
        out += ch;
    }
  }
  return out;
}

/**
 * RFC 4514 LDAP Distinguished Name (DN) value escaping.
 */
export function escapeLdapDnValue(value: string): string {
  if (!value) return '';
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (i === 0 && (ch === ' ' || ch === '#')) {
      out += '\\' + ch;
    } else if (i === value.length - 1 && ch === ' ') {
      out += '\\ ';
    } else if ('"\\+,;<=>'.includes(ch)) {
      out += '\\' + ch;
    } else if (ch === '\0') {
      out += '\\00';
    } else {
      out += ch;
    }
  }
  return out;
}

function parseCsvList(raw: string | undefined, fallback: string[]): string[] {
  if (!raw || !raw.trim()) return fallback;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Maps a user's resolved LDAP POSIX / groupOfNames CNs to a VOW CASL role.
 * Evaluates in highest-privilege order: owner -> admin -> operator -> viewer -> defaultRole.
 */
export function resolveVowRoleFromLdapGroups(
  groups: string[],
  config?: Partial<
    Pick<
      VowLdapConfig,
      'ownerGroups' | 'adminGroups' | 'operatorGroups' | 'viewerGroups' | 'defaultRole'
    >
  >
): VowLdapRole {
  const lower = new Set(groups.map((g) => g.toLowerCase()));
  const ownerGroups = config?.ownerGroups ?? ['axonwall-admin'];
  const adminGroups = config?.adminGroups ?? ['vow-admin'];
  const operatorGroups = config?.operatorGroups ?? ['axonwall-operator', 'vow-operator'];
  const viewerGroups = config?.viewerGroups ?? ['axonwall-readonly', 'vow-readonly'];

  if (ownerGroups.some((g) => lower.has(g.toLowerCase()))) return 'owner';
  if (adminGroups.some((g) => lower.has(g.toLowerCase()))) return 'admin';
  if (operatorGroups.some((g) => lower.has(g.toLowerCase()))) return 'operator';
  if (viewerGroups.some((g) => lower.has(g.toLowerCase()))) return 'viewer';
  return config?.defaultRole ?? 'viewer';
}

interface AxonwallPluginBindingFile {
  pluginId?: string;
  enabled?: boolean;
  url?: string;
  baseDn?: string;
  bindDn?: string;
  bindPassword?: string;
  userSearchBase?: string;
  userSearchFilter?: string;
  groupSearchBase?: string;
  groupSearchFilter?: string;
  roleGroups?: {
    owner?: string[];
    admin?: string[];
    operator?: string[];
    readonly?: string[];
    viewer?: string[];
  };
}

function readJsonSafe<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export interface ResolveVowLdapConfigOptions {
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
  storeLdap?: Partial<VowLdapConfig>;
  bindingFileOverride?: string;
}

/**
 * Resolves the active VOW LDAP configuration by merging:
 * 1. Explicit `.vow/authz.yaml` `ldap` block (if provided)
 * 2. Axonwall plugin binding file (`/etc/axonwall/ldap-plugins/vigilant-octo-waffle.json` or `/etc/axonwall/vow/ldap.json`)
 * 3. `VOW_LDAP_*` environment variables
 */
export function resolveVowLdapConfig(opts: ResolveVowLdapConfigOptions = {}): VowLdapConfig {
  const env = opts.env ?? process.env;
  const storeLdap = opts.storeLdap ?? {};

  const candidateBindingFiles = [
    opts.bindingFileOverride,
    storeLdap.bindingFile,
    env.VOW_LDAP_BINDING_FILE,
    DEFAULT_AXONWALL_VOW_LDAP_BINDING_FILE,
    FALLBACK_AXONWALL_VOW_LDAP_FILE,
    opts.projectRoot ? path.join(opts.projectRoot, '.vow', 'ldap.json') : undefined,
  ].filter((p): p is string => Boolean(p && p.trim()));

  let binding: AxonwallPluginBindingFile | null = null;
  let activeBindingFile: string | undefined;
  for (const file of candidateBindingFiles) {
    const parsed = readJsonSafe<AxonwallPluginBindingFile>(file);
    if (parsed) {
      binding = parsed;
      activeBindingFile = file;
      break;
    }
  }

  const envEnabled =
    env.VOW_LDAP_ENABLED !== undefined
      ? env.VOW_LDAP_ENABLED === 'true' || env.VOW_LDAP_ENABLED === '1'
      : undefined;

  const enabled =
    envEnabled ??
    storeLdap.enabled ??
    (binding?.enabled !== undefined ? Boolean(binding.enabled) : false);

  const baseDn =
    env.VOW_LDAP_BASE_DN?.trim() ||
    storeLdap.baseDn?.trim() ||
    binding?.baseDn?.trim() ||
    'dc=axonwall,dc=local';

  const url =
    env.VOW_LDAP_URL?.trim() ||
    storeLdap.url?.trim() ||
    binding?.url?.trim() ||
    'ldap://127.0.0.1:389';

  const bindDn =
    env.VOW_LDAP_BIND_DN?.trim() || storeLdap.bindDn?.trim() || binding?.bindDn?.trim() || undefined;

  const bindPassword =
    env.VOW_LDAP_BIND_PASSWORD ||
    storeLdap.bindPassword ||
    binding?.bindPassword ||
    undefined;

  const userSearchBase =
    env.VOW_LDAP_USER_SEARCH_BASE?.trim() ||
    storeLdap.userSearchBase?.trim() ||
    binding?.userSearchBase?.trim() ||
    `ou=users,${baseDn}`;

  const userSearchFilter =
    env.VOW_LDAP_USER_SEARCH_FILTER?.trim() ||
    storeLdap.userSearchFilter?.trim() ||
    binding?.userSearchFilter?.trim() ||
    '(uid={username})';

  const groupSearchBase =
    env.VOW_LDAP_GROUP_SEARCH_BASE?.trim() ||
    storeLdap.groupSearchBase?.trim() ||
    binding?.groupSearchBase?.trim() ||
    `ou=groups,${baseDn}`;

  const groupSearchFilter =
    env.VOW_LDAP_GROUP_SEARCH_FILTER?.trim() ||
    storeLdap.groupSearchFilter?.trim() ||
    binding?.groupSearchFilter?.trim() ||
    '(|(&(objectClass=posixGroup)(memberUid={username}))(&(objectClass=groupOfNames)(member={userDn})))';

  // Map Axonwall roleGroups into VOW's 4 human roles (owner, admin, operator, viewer)
  const bindingOwnerGroups = binding?.roleGroups?.owner ?? ['axonwall-admin'];
  const bindingAdminGroups =
    binding?.roleGroups?.admin ?? ['axonwall-admin', 'vow-admin'];
  const bindingOperatorGroups =
    binding?.roleGroups?.operator ?? ['axonwall-operator', 'vow-operator'];
  const bindingViewerGroups =
    binding?.roleGroups?.viewer ??
    binding?.roleGroups?.readonly ?? ['axonwall-readonly', 'vow-readonly'];

  const ownerGroups = parseCsvList(
    env.VOW_LDAP_OWNER_GROUPS,
    storeLdap.ownerGroups ?? bindingOwnerGroups
  );
  const adminGroups = parseCsvList(
    env.VOW_LDAP_ADMIN_GROUPS,
    storeLdap.adminGroups ?? bindingAdminGroups
  );
  const operatorGroups = parseCsvList(
    env.VOW_LDAP_OPERATOR_GROUPS,
    storeLdap.operatorGroups ?? bindingOperatorGroups
  );
  const viewerGroups = parseCsvList(
    env.VOW_LDAP_VIEWER_GROUPS,
    storeLdap.viewerGroups ?? bindingViewerGroups
  );

  const rawDefaultRole = (
    env.VOW_LDAP_DEFAULT_ROLE?.trim() ||
    storeLdap.defaultRole ||
    'viewer'
  ) as VowLdapRole;
  const defaultRole: VowLdapRole = ['owner', 'admin', 'operator', 'viewer', 'none'].includes(
    rawDefaultRole
  )
    ? rawDefaultRole
    : 'viewer';

  const autoProvisionPrincipals =
    env.VOW_LDAP_AUTO_PROVISION !== undefined
      ? env.VOW_LDAP_AUTO_PROVISION !== 'false' && env.VOW_LDAP_AUTO_PROVISION !== '0'
      : storeLdap.autoProvisionPrincipals ?? true;

  const allowLocalBreakGlass =
    env.VOW_LDAP_ALLOW_BREAK_GLASS !== undefined
      ? env.VOW_LDAP_ALLOW_BREAK_GLASS !== 'false' && env.VOW_LDAP_ALLOW_BREAK_GLASS !== '0'
      : storeLdap.allowLocalBreakGlass ?? true;

  return {
    enabled,
    url,
    baseDn,
    bindDn,
    bindPassword,
    userSearchBase,
    userSearchFilter,
    groupSearchBase,
    groupSearchFilter,
    ownerGroups,
    adminGroups,
    operatorGroups,
    viewerGroups,
    defaultRole,
    autoProvisionPrincipals,
    allowLocalBreakGlass,
    tlsRejectUnauthorized: env.VOW_LDAP_TLS_REJECT_UNAUTHORIZED !== 'false',
    connectTimeoutMs: Number(env.VOW_LDAP_TIMEOUT_MS) || 5000,
    ...(activeBindingFile ? { bindingFile: activeBindingFile } : {}),
  };
}

// ---------------------------------------------------------------------------
// Minimal RFC 4511 ASN.1 BER Codec for LDAPv3 Bind & Search
// ---------------------------------------------------------------------------

export function berEncodeLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  const bytes: number[] = [];
  let rem = len;
  while (rem > 0) {
    bytes.unshift(rem & 0xff);
    rem >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

export function berEncodeElement(tag: number, payload: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), berEncodeLength(payload.length), payload]);
}

export function berEncodeInteger(val: number): Buffer {
  if (val === 0) return berEncodeElement(0x02, Buffer.from([0]));
  const bytes: number[] = [];
  let v = val;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v >>= 8;
  }
  if (bytes[0] & 0x80) bytes.unshift(0x00);
  return berEncodeElement(0x02, Buffer.from(bytes));
}

export function berEncodeEnumerated(val: number): Buffer {
  return berEncodeElement(0x0a, Buffer.from([val & 0xff]));
}

export function berEncodeBoolean(val: boolean): Buffer {
  return berEncodeElement(0x01, Buffer.from([val ? 0xff : 0x00]));
}

export function berEncodeOctetString(str: string | Buffer): Buffer {
  const buf = typeof str === 'string' ? Buffer.from(str, 'utf-8') : str;
  return berEncodeElement(0x04, buf);
}

export function berEncodeSequence(items: Buffer[], tag = 0x30): Buffer {
  return berEncodeElement(tag, Buffer.concat(items));
}

export interface BerElement {
  tag: number;
  value: Buffer;
  headerLength: number;
  totalLength: number;
}

export function berDecodeElement(buf: Buffer, offset = 0): BerElement | null {
  if (offset >= buf.length) return null;
  const tag = buf[offset];
  if (offset + 1 >= buf.length) return null;
  const lenByte = buf[offset + 1];
  let len = 0;
  let headerLength = 2;
  if ((lenByte & 0x80) === 0) {
    len = lenByte;
  } else {
    const numOctets = lenByte & 0x7f;
    if (numOctets === 0 || numOctets > 4 || offset + 2 + numOctets > buf.length) return null;
    headerLength = 2 + numOctets;
    for (let i = 0; i < numOctets; i++) {
      len = (len << 8) | buf[offset + 2 + i];
    }
  }
  const totalLength = headerLength + len;
  if (offset + totalLength > buf.length) return null;
  return {
    tag,
    value: buf.subarray(offset + headerLength, offset + totalLength),
    headerLength,
    totalLength,
  };
}

export function berDecodeChildren(buf: Buffer): BerElement[] {
  const out: BerElement[] = [];
  let offset = 0;
  while (offset < buf.length) {
    const el = berDecodeElement(buf, offset);
    if (!el) break;
    out.push(el);
    offset += el.totalLength;
  }
  return out;
}

export function berDecodeInt(buf: Buffer): number {
  let val = 0;
  for (let i = 0; i < buf.length; i++) {
    val = (val << 8) | buf[i];
  }
  return val;
}

/**
 * Encodes an RFC 4515 filter string such as `(uid=alice)` or
 * `(|(&(objectClass=posixGroup)(memberUid=alice))(&(objectClass=groupOfNames)(member=uid=alice,ou=users,dc=axonwall,dc=local)))`
 * into an RFC 4511 BER Filter element.
 */
export function berEncodeFilter(filterStr: string): Buffer {
  let s = filterStr.trim();
  if (s.startsWith('(') && s.endsWith(')')) {
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith('&') || s.startsWith('|')) {
    const tag = s[0] === '&' ? 0xa0 : 0xa1;
    const rest = s.slice(1).trim();
    const subFilters: Buffer[] = [];
    let depth = 0;
    let start = -1;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '(') {
        if (depth === 0) start = i;
        depth++;
      } else if (rest[i] === ')') {
        depth--;
        if (depth === 0 && start !== -1) {
          subFilters.push(berEncodeFilter(rest.slice(start, i + 1)));
          start = -1;
        }
      }
    }
    return berEncodeSequence(subFilters, tag);
  }
  const eqIdx = s.indexOf('=');
  if (eqIdx === -1) {
    return berEncodeElement(0x87, Buffer.from(s, 'utf-8'));
  }
  const attr = s.slice(0, eqIdx).trim();
  const rawVal = s.slice(eqIdx + 1);
  if (rawVal === '*') {
    return berEncodeElement(0x87, Buffer.from(attr, 'utf-8'));
  }
  const unescaped = rawVal.replace(/\\([0-9a-fA-F]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  return berEncodeSequence(
    [berEncodeOctetString(attr), berEncodeOctetString(unescaped)],
    0xa3 // equalityMatch [3]
  );
}

export function buildLdapBindRequest(messageId: number, bindDn: string, password: string): Buffer {
  const bindReq = berEncodeSequence(
    [
      berEncodeInteger(3), // version 3
      berEncodeOctetString(bindDn),
      berEncodeElement(0x80, Buffer.from(password, 'utf-8')), // simple auth [0]
    ],
    0x60 // BindRequest [APPLICATION 0]
  );
  return berEncodeSequence([berEncodeInteger(messageId), bindReq]);
}

export function buildLdapSearchRequest(
  messageId: number,
  baseDn: string,
  filter: string,
  attributes: string[]
): Buffer {
  const searchReq = berEncodeSequence(
    [
      berEncodeOctetString(baseDn),
      berEncodeEnumerated(2), // wholeSubtree (2)
      berEncodeEnumerated(0), // neverDerefAliases (0)
      berEncodeInteger(100), // sizeLimit
      berEncodeInteger(10), // timeLimit
      berEncodeBoolean(false), // typesOnly
      berEncodeFilter(filter),
      berEncodeSequence(attributes.map((a) => berEncodeOctetString(a))),
    ],
    0x63 // SearchRequest [APPLICATION 3]
  );
  return berEncodeSequence([berEncodeInteger(messageId), searchReq]);
}

export interface LdapSearchEntry {
  dn: string;
  attributes: Record<string, string[]>;
}

const defaultTransport: LdapTransportFactory = (url, timeoutMs, rejectUnauthorized) =>
  new Promise((resolve, reject) => {
    const isTls = url.protocol === 'ldaps:';
    const port = url.port ? Number(url.port) : isTls ? 636 : 389;
    const host = url.hostname || '127.0.0.1';

    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error(`LDAP connection timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const onConnect = () => {
      clearTimeout(timer);
      resolve(sock);
    };

    const sock = isTls
      ? tls.connect({ host, port, rejectUnauthorized }, onConnect)
      : net.connect({ host, port }, onConnect);

    sock.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

class LdapClientSession {
  private buffer: Buffer = Buffer.alloc(0);
  private nextMsgId = 1;
  private pending = new Map<
    number,
    {
      entries: LdapSearchEntry[];
      resolve: (res: { resultCode: number; diagnosticMessage: string; entries: LdapSearchEntry[] }) => void;
      reject: (err: Error) => void;
    }
  >();

  constructor(private sock: LdapSocketLike) {
    sock.on('data', (chunk: Buffer) => this.onData(chunk));
    sock.on('error', (err: Error) => {
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    });
    sock.on('close', () => {
      for (const p of this.pending.values()) {
        p.reject(new Error('LDAP socket closed unexpectedly'));
      }
      this.pending.clear();
    });
  }

  private onData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length > 0) {
      const msg = berDecodeElement(this.buffer, 0);
      if (!msg) break;
      this.buffer = this.buffer.subarray(msg.totalLength);
      const children = berDecodeChildren(msg.value);
      if (children.length < 2) continue;
      const msgId = berDecodeInt(children[0].value);
      const op = children[1];
      const handler = this.pending.get(msgId);
      if (!handler) continue;

      if (op.tag === 0x64) {
        // SearchResultEntry [APPLICATION 4]
        const entryParts = berDecodeChildren(op.value);
        if (entryParts.length >= 2) {
          const dn = entryParts[0].value.toString('utf-8');
          const attrs: Record<string, string[]> = {};
          for (const attrSeq of berDecodeChildren(entryParts[1].value)) {
            const kv = berDecodeChildren(attrSeq.value);
            if (kv.length >= 2) {
              const name = kv[0].value.toString('utf-8').toLowerCase();
              const vals = berDecodeChildren(kv[1].value).map((v) => v.value.toString('utf-8'));
              attrs[name] = vals;
            }
          }
          handler.entries.push({ dn, attributes: attrs });
        }
      } else if (op.tag === 0x61 || op.tag === 0x65) {
        // BindResponse [APPLICATION 1] or SearchResultDone [APPLICATION 5]
        const resParts = berDecodeChildren(op.value);
        const resultCode = resParts.length > 0 ? berDecodeInt(resParts[0].value) : 1;
        const diagnosticMessage =
          resParts.length > 2 ? resParts[2].value.toString('utf-8') : '';
        this.pending.delete(msgId);
        handler.resolve({ resultCode, diagnosticMessage, entries: handler.entries });
      }
    }
  }

  async bind(bindDn: string, password: string) {
    const id = this.nextMsgId++;
    const pkt = buildLdapBindRequest(id, bindDn, password);
    return new Promise<{ resultCode: number; diagnosticMessage: string }>((resolve, reject) => {
      this.pending.set(id, { entries: [], resolve, reject });
      this.sock.write(pkt);
    });
  }

  async search(baseDn: string, filter: string, attributes: string[]) {
    const id = this.nextMsgId++;
    const pkt = buildLdapSearchRequest(id, baseDn, filter, attributes);
    return new Promise<{
      resultCode: number;
      diagnosticMessage: string;
      entries: LdapSearchEntry[];
    }>((resolve, reject) => {
      this.pending.set(id, { entries: [], resolve, reject });
      this.sock.write(pkt);
    });
  }

  close() {
    try {
      this.sock.end();
    } catch {
      // ignore
    }
  }
}

/**
 * Authenticates a user against OpenLDAP (`slapd`), checks `pwdAccountLockedTime`,
 * resolves POSIX & groupOfNames memberships, and maps them to a VOW CASL role.
 */
export async function authenticateVowLdapUser(
  username: string,
  password: string,
  configOverride?: Partial<VowLdapConfig>,
  transport: LdapTransportFactory = defaultTransport
): Promise<VowLdapAuthResult> {
  const cleanUser = username.trim();
  if (!cleanUser || !password) {
    return { authenticated: false, error: 'Username and password are required' };
  }

  const baseConfig = resolveVowLdapConfig();
  const config: VowLdapConfig = { ...baseConfig, ...configOverride };
  if (!config.enabled) {
    return { authenticated: false, error: 'LDAP authentication is not enabled' };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(config.url);
  } catch {
    return { authenticated: false, error: `Invalid LDAP URL: ${config.url}` };
  }

  let sock: LdapSocketLike;
  try {
    sock = await transport(parsedUrl, config.connectTimeoutMs, config.tlsRejectUnauthorized);
  } catch (err) {
    return {
      authenticated: false,
      error: `Failed to connect to LDAP directory: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const session = new LdapClientSession(sock);
  try {
    const escapedFilterUser = escapeLdapFilter(cleanUser);
    const escapedDnUser = escapeLdapDnValue(cleanUser);

    let userDn = `uid=${escapedDnUser},${config.userSearchBase}`;
    let displayName = cleanUser;
    let email: string | undefined;
    let resolvedUid = cleanUser;

    // 1. Service Bind & User Search (if service account credentials are provided)
    if (config.bindDn && config.bindPassword) {
      const svcBind = await session.bind(config.bindDn, config.bindPassword);
      if (svcBind.resultCode !== 0) {
        return {
          authenticated: false,
          error: `LDAP service account bind failed (code ${svcBind.resultCode})`,
        };
      }

      const userFilter = config.userSearchFilter.replace(/\{username\}/g, escapedFilterUser);
      const userSearch = await session.search(config.userSearchBase, userFilter, [
        'uid',
        'cn',
        'displayName',
        'mail',
        'pwdAccountLockedTime',
      ]);

      if (userSearch.resultCode !== 0 || userSearch.entries.length === 0) {
        return { authenticated: false, error: 'Invalid username or password' };
      }

      const entry = userSearch.entries[0];
      userDn = entry.dn;
      const lockedAttr = entry.attributes['pwdaccountlockedtime']?.[0];
      if (lockedAttr) {
        return {
          authenticated: false,
          error: 'Directory account is locked by OpenLDAP password policy',
        };
      }
      resolvedUid = entry.attributes['uid']?.[0] || cleanUser;
      displayName =
        entry.attributes['displayname']?.[0] ||
        entry.attributes['cn']?.[0] ||
        resolvedUid;
      email = entry.attributes['mail']?.[0];
    }

    // 2. Simple Bind as the User DN with the user's password
    const userBind = await session.bind(userDn, password);
    if (userBind.resultCode !== 0) {
      return { authenticated: false, error: 'Invalid username or password' };
    }

    // 3. Re-bind as service account (if configured) to search POSIX / groupOfNames memberships
    if (config.bindDn && config.bindPassword) {
      await session.bind(config.bindDn, config.bindPassword);
    }

    const groupFilter = config.groupSearchFilter
      .replace(/\{username\}/g, escapeLdapFilter(resolvedUid))
      .replace(/\{userDn\}/g, escapeLdapFilter(userDn));

    const groupSearch = await session.search(config.groupSearchBase, groupFilter, ['cn']);
    const groups =
      groupSearch.resultCode === 0
        ? Array.from(
            new Set(
              groupSearch.entries
                .flatMap((e) => e.attributes['cn'] ?? [])
                .map((g) => g.trim())
                .filter(Boolean)
            )
          )
        : [];

    const mappedRole = resolveVowRoleFromLdapGroups(groups, config);
    if (mappedRole === 'none') {
      return {
        authenticated: false,
        username: resolvedUid,
        dn: userDn,
        groups,
        error: 'Directory user is not a member of any authorized Vigilant Octo Waffle POSIX group',
      };
    }

    return {
      authenticated: true,
      username: resolvedUid,
      displayName,
      ...(email ? { email } : {}),
      dn: userDn,
      groups,
      role: mappedRole,
    };
  } catch (err) {
    return {
      authenticated: false,
      error: `LDAP authentication failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    session.close();
  }
}
