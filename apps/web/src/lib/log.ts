/**
 * Structured operational logging (improvements plan WS4).
 *
 * One JSON object per line on stderr:
 *   { ts, level, msg, route?, principalId?, code?, status?, err? }
 *
 * Deliberately boring and dependency-free: container deployments read
 * these via `docker logs`, and JSON lines stay greppable/parseable.
 * This is NOT the authz audit trail (.vow/audit.log) — audit is a
 * product feature with its own reader API; logs are operational.
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogFields {
  route?: string;
  principalId?: string;
  code?: string;
  status?: number;
  err?: unknown;
  [key: string]: unknown;
}

function serializeError(err: unknown): unknown {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return err;
}

export function log(level: LogLevel, msg: string, fields: LogFields = {}): void {
  const { err, ...rest } = fields;
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...rest,
  };
  if (err !== undefined) entry.err = serializeError(err);
  process.stderr.write(`${JSON.stringify(entry)}\n`);
}

export const logger = {
  info: (msg: string, fields?: LogFields) => log('info', msg, fields),
  warn: (msg: string, fields?: LogFields) => log('warn', msg, fields),
  error: (msg: string, fields?: LogFields) => log('error', msg, fields),
};
