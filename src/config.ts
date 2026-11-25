import { z } from "zod";

const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);

const envSchema = z.object({
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  DB_PATH: z.string().min(1).default("./data/cdr-monitor.db"),
  LOG_LEVEL: logLevelSchema.default("info"),
  CDR_TIMEOUT_MS: z.coerce.number().int().min(500).max(30000).default(5000),
  ALLOW_LIVE_SYNC: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export type LogLevel = z.infer<typeof logLevelSchema>;

export interface AppConfig {
  port: number;
  dbPath: string;
  logLevel: LogLevel;
  cdrTimeoutMs: number;
  allowLiveSync: boolean;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid application configuration: ${details}`);
  }

  return {
    port: parsed.data.PORT,
    dbPath: parsed.data.DB_PATH,
    logLevel: parsed.data.LOG_LEVEL,
    cdrTimeoutMs: parsed.data.CDR_TIMEOUT_MS,
    allowLiveSync: parsed.data.ALLOW_LIVE_SYNC,
  };
}
