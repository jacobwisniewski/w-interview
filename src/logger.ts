import type { LogLevel } from "./config.js";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): Logger;
}

export function createLogger(
  level: LogLevel = "info",
  baseContext: Record<string, unknown> = {},
  sink: (line: string) => void = (line) => console.log(line),
): Logger {
  const minPriority = LEVEL_PRIORITY[level];

  function emit(entryLevel: LogLevel, msg: string, meta?: Record<string, unknown>) {
    if (LEVEL_PRIORITY[entryLevel] < minPriority) return;
    const record = {
      timestamp: new Date().toISOString(),
      level: entryLevel,
      msg,
      ...baseContext,
      ...meta,
    };
    sink(JSON.stringify(record));
  }

  return {
    debug: (msg, meta) => emit("debug", msg, meta),
    info: (msg, meta) => emit("info", msg, meta),
    warn: (msg, meta) => emit("warn", msg, meta),
    error: (msg, meta) => emit("error", msg, meta),
    child: (context) => createLogger(level, { ...baseContext, ...context }, sink),
  };
}
