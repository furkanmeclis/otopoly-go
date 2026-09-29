/**
 * App-wide structured logger.
 *
 * - Every entry has a scope (module), level, message and optional data.
 * - Entries are kept in an in-memory ring buffer (diagnostics screen, bug reports).
 * - In development entries are mirrored to the Metro console.
 * - Remote sinks (Sentry, own backend) plug in via `addLogSink` without touching call sites.
 * - Sensitive keys are redacted before an entry is stored or forwarded.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogEntry = {
  id: number;
  ts: string;
  level: LogLevel;
  scope: string;
  message: string;
  data?: unknown;
};

export type LogSink = (entry: LogEntry) => void;

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const BUFFER_SIZE = 500;
const SENSITIVE_KEYS = /pass(word)?|token|secret|authorization|otp|totp|code_verifier|refresh/i;

let minLevel: LogLevel = __DEV__ ? 'debug' : 'info';
let seq = 0;
const buffer: LogEntry[] = [];
const sinks = new Set<LogSink>();
const listeners = new Set<() => void>();

function redact(value: unknown, depth = 0): unknown {
  if (value == null || depth > 5) return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 2000) return `${value.slice(0, 2000)}…`;
  return value;
}

function consoleWrite(entry: LogEntry) {
  if (!__DEV__) return;
  const line = `[${entry.level.toUpperCase()}] ${entry.scope}: ${entry.message}`;
  const args = entry.data === undefined ? [line] : [line, entry.data];
   
  (entry.level === 'error' ? console.error : entry.level === 'warn' ? console.warn : console.log)(...args);
}

function write(level: LogLevel, scope: string, message: string, data?: unknown) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
  const entry: LogEntry = {
    id: ++seq,
    ts: new Date().toISOString(),
    level,
    scope,
    message,
    data: data === undefined ? undefined : redact(data),
  };
  buffer.push(entry);
  if (buffer.length > BUFFER_SIZE) buffer.shift();
  consoleWrite(entry);
  for (const sink of sinks) {
    try {
      sink(entry);
    } catch {
      // A failing sink must never break the app or recurse into the logger.
    }
  }
  for (const l of listeners) l();
}

export type Logger = {
  debug: (message: string, data?: unknown) => void;
  info: (message: string, data?: unknown) => void;
  warn: (message: string, data?: unknown) => void;
  error: (message: string, data?: unknown) => void;
  child: (sub: string) => Logger;
};

export function createLogger(scope: string): Logger {
  return {
    debug: (m, d) => write('debug', scope, m, d),
    info: (m, d) => write('info', scope, m, d),
    warn: (m, d) => write('warn', scope, m, d),
    error: (m, d) => write('error', scope, m, d),
    child: (sub) => createLogger(`${scope}.${sub}`),
  };
}

export const logger = createLogger('app');

export function setLogLevel(level: LogLevel) {
  minLevel = level;
}

export function addLogSink(sink: LogSink) {
  sinks.add(sink);
  return () => sinks.delete(sink);
}

export function getLogEntries(): readonly LogEntry[] {
  return buffer;
}

export function clearLogEntries() {
  buffer.length = 0;
  for (const l of listeners) l();
}

export function subscribeLogs(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function formatLogsForExport(entries: readonly LogEntry[] = buffer) {
  return entries
    .map((e) => `${e.ts} ${e.level.toUpperCase()} ${e.scope} ${e.message}${e.data === undefined ? '' : ` ${JSON.stringify(e.data)}`}`)
    .join('\n');
}
