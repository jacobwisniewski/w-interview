import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("applies safe defaults when env vars are omitted", () => {
    const config = loadConfig({});
    expect(config).toEqual({
      port: 3000,
      dbPath: "./data/cdr-monitor.db",
      logLevel: "info",
      cdrTimeoutMs: 5000,
      allowLiveSync: true,
    });
  });

  it("parses valid overrides cleanly", () => {
    const config = loadConfig({
      PORT: "8080",
      DB_PATH: ":memory:",
      LOG_LEVEL: "debug",
      CDR_TIMEOUT_MS: "2500",
      ALLOW_LIVE_SYNC: "false",
    });
    expect(config).toEqual({
      port: 8080,
      dbPath: ":memory:",
      logLevel: "debug",
      cdrTimeoutMs: 2500,
      allowLiveSync: false,
    });
  });

  it("fails fast with clear message on invalid port or timeout", () => {
    expect(() => loadConfig({ PORT: "99999" })).toThrow(/Invalid application configuration.*PORT/);
    expect(() => loadConfig({ CDR_TIMEOUT_MS: "50" })).toThrow(
      /Invalid application configuration.*CDR_TIMEOUT_MS/,
    );
  });
});
