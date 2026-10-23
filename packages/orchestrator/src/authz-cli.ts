import * as fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import * as readline from 'node:readline/promises';
import {
  PERMISSIONS,
  ROLES,
  createEmptyStore,
  loadAuthzStore,
  saveAuthzStore,
  authzStorePath,
  upsertPrincipal,
  removePrincipal,
  generatePrincipalToken,
  hashPassword,
  MIN_PASSWORD_LENGTH,
  hashToken,
  findPrincipalByToken,
  decide,
  isPermission,
  validateGrantContext,
  pruneExpiredSessions,
  revokePrincipalSessions,
  type AuthMethod,
  type AuthzStore,
  type Grant,
  type GrantContext,
  type Permission,
  type Principal,
  type Role,
} from './authz.js';
import { findProjectRoot } from './config.js';
import { ensureDevCertificate } from './tls.js';

/**
 * `vow authz` — management CLI for the authorization store (plan §8).
 *
 *   vow authz init   [--name <name>]                        create the store + first owner (prints its token once)
 *   vow authz add    <name> [--role <role>] [--kind human|service]
 *                    [--oidc-subject <sub>] [--grant <permission>]...
 *                    [--scope-app <appId>] [--scope-namespace <ns>]
 *   vow authz list                                          list principals (never prints token hashes)
 *   vow authz sessions [--principal <id>]                   list active browser sessions (hash prefixes only)
 *   vow authz revoke <principal-id>                         remove a principal
 *   vow authz revoke-sessions <principal-id>                revoke every browser session for a principal
 *   vow authz rotate <principal-id>                         issue a new token (printed once)
 *   vow authz check  <token> <permission> [--app <id>] [--namespace <ns>]
 *
 * The store lives at <projectRoot>/.vow/authz.yaml. The project root is
 * found by walking up from the cwd (override with VOW_PROJECT_ROOT).
 * Tokens are printed exactly once, at creation/rotation time.
 */

export interface AuthzCliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

const defaultIo: AuthzCliIo = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
};

const USAGE = `Usage: vow authz <command>

Commands:
  init [--name <name>] [--password <password>] [--token <token>]
                                  Create the store and its first owner principal
  add <name> [options]            Add a principal (token printed once)
    --role <role>                 ${ROLES.join(' | ')} (default: operator)
    --kind <kind>                 human | service (default: human)
    --oidc-subject <sub>          Map an OIDC identity instead of issuing a token
    --grant <permission>          Extra permission grant (repeatable)
    --scope-app <appId>           Scope all --grant entries to an app
    --scope-namespace <ns>        Scope all --grant entries to a namespace
    --context <json>              Context conditions for all --grant entries (WS5):
                                  {"notBefore": iso, "notAfter": iso,
                                   "source": "loopback"|"any",
                                   "authMethod": "session"|"token"|"oidc"|"any"}
  list                            List principals
  sessions [--principal <id>]     List active browser sessions (id-hash prefix, principal, expiry)
  revoke <principal-id>           Remove a principal
  revoke-sessions <principal-id>  Revoke every browser session for a principal
  rotate <principal-id>           Issue a replacement token (printed once)
  check <token> <permission> [--app <appId>] [--namespace <ns>]
                                  Dry-run a permission check, prints the decision reason
    --at <iso>                    Evaluate context grants at this instant (default: now)
    --loopback                    Evaluate as a loopback (local board) request
    --auth-method <m>             session | token | oidc (default: token)`;

function parseFlags(args: string[]): { positional: string[]; flags: Map<string, string[]> } {
  const positional: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[++i] : 'true';
      flags.set(key, [...(flags.get(key) ?? []), value]);
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function flag(flags: Map<string, string[]>, name: string): string | undefined {
  return flags.get(name)?.[0];
}

function slugify(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'principal';
}

function newPrincipalId(store: AuthzStore, name: string): string {
  const base = `p_${slugify(name)}`;
  if (!store.principals.some((p) => p.id === base)) return base;
  return `${base}_${randomBytes(2).toString('hex')}`;
}

function requireStore(root: string, io: AuthzCliIo): AuthzStore | null {
  const loaded = loadAuthzStore(root);
  if (loaded.status === 'disabled') {
    io.err('No authorization store found. Run `vow authz init` first.');
    return null;
  }
  if (loaded.status === 'invalid') {
    io.err(`Authorization store is invalid: ${loaded.error}`);
    return null;
  }
  return loaded.store;
}

function printTokenOnce(io: AuthzCliIo, principal: Principal, token: string): void {
  io.out(`Principal: ${principal.id} (${principal.name}, role: ${principal.role})`);
  io.out('');
  io.out('Token (shown once — store it now, it cannot be recovered):');
  io.out(`  ${token}`);
}

async function cmdInit(root: string, args: string[], io: AuthzCliIo): Promise<number> {
  const { flags } = parseFlags(args);
  const file = authzStorePath(root);
  if (fs.existsSync(file)) {
    const existing = loadAuthzStore(root);
    if (existing.status === 'ready' && existing.store.principals.length > 0) {
      io.err(`Store already initialized at ${file} (${existing.store.principals.length} principals).`);
      return 1;
    }
    if (existing.status === 'invalid') {
      io.err(`Store at ${file} is invalid: ${existing.error}`);
      return 1;
    }
  }

  const name = flag(flags, 'name') ?? 'Owner';
  let customPassword = flag(flags, 'password') ?? flag(flags, 'token');
  if (customPassword === 'true') {
    if (process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      customPassword = await rl.question('Enter initial admin password: ');
      rl.close();
    } else {
      io.err('Error: --password requires a value when run non-interactively.');
      return 1;
    }
  }

  const hasCustomPassword = Boolean(customPassword && customPassword.trim());
  const token = hasCustomPassword ? customPassword!.trim() : generatePrincipalToken();
  if (hasCustomPassword && token.length < MIN_PASSWORD_LENGTH) {
    io.err(`Error: the initial owner password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    return 1;
  }
  const owner: Principal = {
    id: newPrincipalId(createEmptyStore(), name),
    name,
    kind: 'human',
    role: 'owner',
    // A human-chosen password gets the scrypt scheme; a generated token sha256.
    tokenHash: hasCustomPassword ? hashPassword(token) : hashToken(token),
  };
  saveAuthzStore(root, { version: 1, principals: [owner] });
  io.out(`Created authorization store at ${file}`);
  try {
    await ensureDevCertificate(root);
    io.out(`Generated mkcert TLS development certificate in .vow/certs/`);
  } catch (err) {
    io.out(`Note: TLS dev certificate setup deferred: ${err instanceof Error ? err.message : err}`);
  }
  if (customPassword && customPassword.trim()) {
    io.out(`Principal: ${owner.id} (${owner.name}, role: ${owner.role})`);
    io.out(`Initial owner password configured successfully.`);
  } else {
    printTokenOnce(io, owner, token);
  }
  return 0;
}

async function cmdAdd(root: string, args: string[], io: AuthzCliIo): Promise<number> {
  const { positional, flags } = parseFlags(args);
  const name = positional[0];
  if (!name) {
    io.err('Usage: vow authz add <name> [--role <role>] [--grant <permission>]...');
    return 1;
  }

  const store = requireStore(root, io);
  if (!store) return 1;

  const role = (flag(flags, 'role') ?? 'operator') as Role;
  if (!ROLES.includes(role)) {
    io.err(`Unknown role: ${role}. Roles: ${ROLES.join(', ')}`);
    return 1;
  }
  const kind = (flag(flags, 'kind') ?? 'human') as Principal['kind'];
  if (kind !== 'human' && kind !== 'service') {
    io.err(`Unknown kind: ${kind}. Use human or service.`);
    return 1;
  }

  const scopeApp = flag(flags, 'scope-app');
  const scopeNamespace = flag(flags, 'scope-namespace');
  let context: GrantContext | undefined;
  const contextRaw = flag(flags, 'context');
  if (contextRaw !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(contextRaw);
    } catch {
      io.err('--context must be valid JSON, e.g. --context \'{"source":"loopback"}\'');
      return 1;
    }
    const problem = validateGrantContext(parsed);
    if (problem) {
      io.err(`--context: ${problem}`);
      return 1;
    }
    context = parsed as GrantContext;
  }
  const grants: Grant[] = [];
  for (const permission of flags.get('grant') ?? []) {
    if (!isPermission(permission)) {
      io.err(`Unknown permission: ${permission}`);
      return 1;
    }
    const scope =
      scopeApp || scopeNamespace
        ? { ...(scopeApp ? { appId: scopeApp } : {}), ...(scopeNamespace ? { namespace: scopeNamespace } : {}) }
        : undefined;
    grants.push({
      permission: permission as Permission,
      ...(scope ? { scope } : {}),
      ...(context ? { context } : {}),
    });
  }

  const oidcSubject = flag(flags, 'oidc-subject');
  const token = oidcSubject ? null : generatePrincipalToken();
  const principal: Principal = {
    id: newPrincipalId(store, name),
    name,
    kind,
    role,
    ...(token ? { tokenHash: hashToken(token) } : {}),
    ...(oidcSubject ? { oidcSubject } : {}),
    ...(grants.length > 0 ? { grants } : {}),
  };

  saveAuthzStore(root, upsertPrincipal(store, principal));
  if (token) {
    printTokenOnce(io, principal, token);
  } else {
    io.out(`Principal: ${principal.id} (${principal.name}, role: ${principal.role}, OIDC subject: ${oidcSubject})`);
  }
  return 0;
}

async function cmdList(root: string, io: AuthzCliIo): Promise<number> {
  const store = requireStore(root, io);
  if (!store) return 1;
  if (store.principals.length === 0) {
    io.out('No principals yet. Run `vow authz add <name>` to create one.');
    return 0;
  }
  for (const p of store.principals) {
    const grants = (p.grants ?? [])
      .map((g) => {
        const scope = g.scope
          ? Object.entries(g.scope)
              .map(([k, v]) => `${k}=${v}`)
              .join(',')
          : 'global';
        const ctx: string[] = [];
        if (g.context) {
          if (g.context.source && g.context.source !== 'any') ctx.push(`src=${g.context.source}`);
          if (g.context.authMethod && g.context.authMethod !== 'any') {
            ctx.push(`auth=${g.context.authMethod}`);
          }
          if (g.context.notBefore) ctx.push(`from=${g.context.notBefore}`);
          if (g.context.notAfter) ctx.push(`until=${g.context.notAfter}`);
        }
        return `${g.permission}[${scope}]${ctx.length > 0 ? `{${ctx.join(' ')}}` : ''}`;
      })
      .join(' ');
    io.out(
      `${p.id.padEnd(24)} ${p.role.padEnd(9)} ${p.kind.padEnd(8)} ${p.name}` +
        `${p.disabled ? ' (disabled)' : ''}${p.oidcSubject ? ` oidc:${p.oidcSubject}` : ''}${grants ? ` grants: ${grants}` : ''}`
    );
  }
  return 0;
}

async function cmdSessions(root: string, args: string[], io: AuthzCliIo): Promise<number> {
  const { flags } = parseFlags(args);
  const store = requireStore(root, io);
  if (!store) return 1;
  const principalId = flag(flags, 'principal');
  if (principalId && !store.principals.some((p) => p.id === principalId)) {
    io.err(`Unknown principal: ${principalId}`);
    return 1;
  }
  const active = (pruneExpiredSessions(store).sessions ?? []).filter(
    (sess) => !principalId || sess.principalId === principalId
  );
  if (active.length === 0) {
    io.out(principalId ? `No active sessions for ${principalId}.` : 'No active sessions.');
    return 0;
  }
  for (const sess of active) {
    const principal = store.principals.find((p) => p.id === sess.principalId);
    const who = principal ? `${sess.principalId} (${principal.name})` : sess.principalId;
    // Only ever a prefix of the stored hash — session ids are never stored,
    // and the full hash stays out of terminal output like token hashes do.
    const prefix = `${sess.idHash.slice(0, 19)}…`;
    io.out(`${prefix.padEnd(22)} ${who.padEnd(28)} created ${sess.createdAt}  expires ${sess.expiresAt}`);
  }
  return 0;
}

async function cmdRevokeSessions(root: string, args: string[], io: AuthzCliIo): Promise<number> {
  const { positional } = parseFlags(args);
  const id = positional[0];
  if (!id) {
    io.err('Usage: vow authz revoke-sessions <principal-id>');
    return 1;
  }
  const store = requireStore(root, io);
  if (!store) return 1;
  if (!store.principals.some((p) => p.id === id)) {
    io.err(`Unknown principal: ${id}`);
    return 1;
  }
  const countFor = (s: AuthzStore) =>
    (s.sessions ?? []).filter((sess) => sess.principalId === id).length;
  const next = revokePrincipalSessions(store, id);
  const revoked = countFor(store) - countFor(next);
  saveAuthzStore(root, next);
  io.out(`Revoked ${revoked} session${revoked === 1 ? '' : 's'} for ${id}.`);
  return 0;
}

async function cmdRevoke(root: string, args: string[], io: AuthzCliIo): Promise<number> {
  const { positional } = parseFlags(args);
  const id = positional[0];
  if (!id) {
    io.err('Usage: vow authz revoke <principal-id>');
    return 1;
  }
  const store = requireStore(root, io);
  if (!store) return 1;
  try {
    saveAuthzStore(root, removePrincipal(store, id));
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    return 1;
  }
  io.out(`Revoked principal ${id}.`);
  return 0;
}

async function cmdRotate(root: string, args: string[], io: AuthzCliIo): Promise<number> {
  const { positional } = parseFlags(args);
  const id = positional[0];
  if (!id) {
    io.err('Usage: vow authz rotate <principal-id>');
    return 1;
  }
  const store = requireStore(root, io);
  if (!store) return 1;
  const existing = store.principals.find((p) => p.id === id);
  if (!existing) {
    io.err(`Unknown principal: ${id}`);
    return 1;
  }
  const token = generatePrincipalToken();
  const updated: Principal = { ...existing, tokenHash: hashToken(token) };
  saveAuthzStore(root, upsertPrincipal(store, updated));
  io.out(`Rotated token for ${id}; the previous token no longer works.`);
  printTokenOnce(io, updated, token);
  return 0;
}

async function cmdCheck(root: string, args: string[], io: AuthzCliIo): Promise<number> {
  const { positional, flags } = parseFlags(args);
  const [token, permission] = positional;
  if (!token || !permission) {
    io.err('Usage: vow authz check <token> <permission> [--app <appId>] [--namespace <ns>]');
    return 1;
  }
  if (!isPermission(permission)) {
    io.err(`Unknown permission: ${permission}. Catalog: ${PERMISSIONS.join(', ')}`);
    return 1;
  }
  const loaded = loadAuthzStore(root);
  const principal = loaded.status === 'ready' ? findPrincipalByToken(loaded.store, token) : null;
  const target = {
    ...(flag(flags, 'app') ? { appId: flag(flags, 'app') } : {}),
    ...(flag(flags, 'namespace') ? { namespace: flag(flags, 'namespace') } : {}),
  };
  const atRaw = flag(flags, 'at');
  const at = atRaw ? new Date(atRaw) : new Date();
  if (Number.isNaN(at.getTime())) {
    io.err(`--at must be an ISO timestamp, got: ${atRaw}`);
    return 1;
  }
  const authMethodRaw = flag(flags, 'auth-method') ?? 'token';
  // Membership comes from the shared grant-context validator (which also
  // accepts the 'any' wildcard — meaningless for a concrete check, so it
  // is rejected here with this command's own message, as before).
  if (authMethodRaw === 'any' || validateGrantContext({ authMethod: authMethodRaw }) !== null) {
    io.err(`--auth-method must be session, token, or oidc, got: ${authMethodRaw}`);
    return 1;
  }
  const authMethod = authMethodRaw as AuthMethod;
  const decision = decide(loaded, principal, permission, target, {
    localBoard: flags.has('loopback'),
    requestContext: { now: at, loopback: flags.has('loopback'), authMethod },
  });
  io.out(
    `${decision.allowed ? 'ALLOW' : 'DENY'} ${permission}` +
      `${principal ? ` for ${principal.id}` : ' (no matching principal)'}` +
      ` — ${decision.reason}`
  );
  return decision.allowed ? 0 : 1;
}

export interface RunAuthzCommandOptions {
  root?: string;
  io?: AuthzCliIo;
}

/** Runs one `vow authz ...` invocation. Returns the process exit code. */
export async function runAuthzCommand(
  args: string[],
  opts: RunAuthzCommandOptions = {}
): Promise<number> {
  const io = opts.io ?? defaultIo;
  const root = opts.root ?? process.env.VOW_PROJECT_ROOT ?? findProjectRoot();
  const [command, ...rest] = args;

  try {
    switch (command) {
      case 'init':
        return await cmdInit(root, rest, io);
      case 'add':
        return await cmdAdd(root, rest, io);
      case 'list':
        return await cmdList(root, io);
      case 'sessions':
        return await cmdSessions(root, rest, io);
      case 'revoke':
        return await cmdRevoke(root, rest, io);
      case 'revoke-sessions':
        return await cmdRevokeSessions(root, rest, io);
      case 'rotate':
        return await cmdRotate(root, rest, io);
      case 'check':
        return await cmdCheck(root, rest, io);
      case 'help':
      case '--help':
      case '-h':
        io.out(USAGE);
        return 0;
      default:
        io.err(command ? `Unknown authz command: ${command}` : 'Missing authz command.');
        io.err(USAGE);
        return 1;
    }
  } catch (err) {
    io.err(`authz: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

// Standalone entry: `node dist/authz-cli.js <command>` (the Ink CLI calls
// runAuthzCommand directly; this guard only fires for direct execution).
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  runAuthzCommand(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    }
  );
}
