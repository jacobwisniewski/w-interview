import { z } from "zod";

const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);

const envSchema = z.object({
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  DB_PATH: z.string().min(1).default("./data/cdr-monitor.db"),
  LOG_LEVEL: logLevelSchema.default("info"),
});

export type LogLevel = z.infer<typeof logLevelSchema>;

export interface AppConfig {
  readonly port: number;
  readonly dbPath: string;
  readonly logLevel: LogLevel;
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
  };
}
