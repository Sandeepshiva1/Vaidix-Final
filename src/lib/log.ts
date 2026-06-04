// HARDENING-PLAN.md item #7 — structured logging + request id.
//
// Single logger across app + workers. Emits structured JSON to stdout/stderr
// with the shape Loki / Vector / Datadog expect. Pino is listed as a dep so
// the operator can swap to it later (richer redaction, faster) by editing
// just this file — call sites stay the same.

import { AsyncLocalStorage } from 'node:async_hooks';

interface LeveledLogger {
  level: string;
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  child(bindings: Record<string, unknown>): LeveledLogger;
}

const LEVEL_ORDER = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVEL_ORDER;

const isDev = process.env.NODE_ENV !== 'production';
const wantedLevel: Level = (process.env.LOG_LEVEL as Level) ?? (isDev ? 'debug' : 'info');

const REDACT_KEYS = new Set([
  'password',
  'passwordHash',
  'tokenHash',
  'token',
  'authorization',
  'cookie',
  'NEXTAUTH_SECRET',
  'GEMINI_API_KEY',
  'SARVAM_API_KEY',
]);

function redact(input: unknown): unknown {
  if (input === null || typeof input !== 'object') return input;
  if (Array.isArray(input)) return input.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    out[k] = REDACT_KEYS.has(k) ? '[REDACTED]' : redact(v);
  }
  return out;
}

function structuredLogger(bindings: Record<string, unknown> = {}): LeveledLogger {
  const min = LEVEL_ORDER[wantedLevel] ?? LEVEL_ORDER.info;
  function emit(level: Level, obj: unknown, msg?: string) {
    if (LEVEL_ORDER[level] < min) return;
    const merged: Record<string, unknown> =
      typeof obj === 'string'
        ? { ...bindings, msg: obj }
        : { ...bindings, ...((obj as Record<string, unknown>) ?? {}), ...(msg ? { msg } : {}) };
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      service: 'vaidix',
      ...(redact(merged) as Record<string, unknown>),
    });
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }
  return {
    level: wantedLevel,
    debug: (o, m) => emit('debug', o, m),
    info: (o, m) => emit('info', o, m),
    warn: (o, m) => emit('warn', o, m),
    error: (o, m) => emit('error', o, m),
    child: (b) => structuredLogger({ ...bindings, ...b }),
  };
}

export const log: LeveledLogger = structuredLogger();

interface LogContext extends Record<string, unknown> {
  reqId?: string;
  userId?: string;
  role?: string;
}

const als = new AsyncLocalStorage<LogContext>();

export function withLogContext<T>(ctx: LogContext, fn: () => T): T {
  return als.run(ctx, fn);
}

export function currentLogContext(): LogContext | undefined {
  return als.getStore();
}

export function ctxLog(): LeveledLogger {
  const ctx = als.getStore();
  return ctx ? log.child(ctx) : log;
}
