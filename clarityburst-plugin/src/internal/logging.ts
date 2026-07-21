/**
 * DEPENDENCY_LEAK (documented, deliberately localized):
 *
 * The migrated router modules (decision-override.ts, pack-registry.ts,
 * router-client.ts) previously imported `createSubsystemLogger` from
 * OpenClaw core (`src/logging/subsystem.ts`), which is NOT part of the
 * plugin SDK public surface and would not be resolvable from an installed
 * npm plugin package.
 *
 * This module is a minimal, dependency-free stand-in implementing the same
 * SubsystemLogger call surface. In the hook-registration stage this should
 * be replaced by the logger provided on the plugin `api` object
 * (`api.logger`), which is the sanctioned SDK logging surface.
 *
 * Behavior: honors CLARITYBURST_LOG_LEVEL (trace|debug|info|warn|error|fatal|silent),
 * defaulting to "warn" so router decisions surface warnings/errors without
 * flooding stdout during tests.
 */

export type SubsystemLogger = {
  subsystem: string;
  isEnabled: (level: LogLevel, target?: "any" | "console" | "file") => boolean;
  trace: (message: string, meta?: Record<string, unknown>) => void;
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
  fatal: (message: string, meta?: Record<string, unknown>) => void;
  raw: (message: string) => void;
  child: (name: string) => SubsystemLogger;
};

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent";

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
  silent: 6,
};

function configuredLevel(): LogLevel {
  const raw = (process.env.CLARITYBURST_LOG_LEVEL ?? "warn").toLowerCase();
  return (Object.keys(LEVEL_ORDER) as LogLevel[]).includes(raw as LogLevel)
    ? (raw as LogLevel)
    : "warn";
}

function levelEnabled(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[configuredLevel()];
}

function emit(
  subsystem: string,
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>,
): void {
  if (!levelEnabled(level)) {
    return;
  }
  const line = `[${subsystem}] ${level.toUpperCase()} ${message}`;
  const sink = level === "error" || level === "fatal" ? console.error : console.log;
  if (meta !== undefined) {
    sink(line, meta);
  } else {
    sink(line);
  }
}

export function createSubsystemLogger(subsystem: string): SubsystemLogger {
  return {
    subsystem,
    isEnabled: (level) => levelEnabled(level),
    trace: (m, meta) => emit(subsystem, "trace", m, meta),
    debug: (m, meta) => emit(subsystem, "debug", m, meta),
    info: (m, meta) => emit(subsystem, "info", m, meta),
    warn: (m, meta) => emit(subsystem, "warn", m, meta),
    error: (m, meta) => emit(subsystem, "error", m, meta),
    fatal: (m, meta) => emit(subsystem, "fatal", m, meta),
    raw: (m) => console.log(m),
    child: (name) => createSubsystemLogger(`${subsystem}:${name}`),
  };
}
