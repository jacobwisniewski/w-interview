import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

describe("Feature: Fail-Fast Application Configuration", () => {
  describe("Given no environment overrides are provided", () => {
    it("Then safe local defaults are applied", () => {
      expect(loadConfig({})).toEqual({
        port: 3000,
        dbPath: "./data/cdr-monitor.db",
        logLevel: "info",
        cdrTimeoutMs: 5000,
        allowLiveSync: true,
      });
    });
  });

  describe("Given valid environment overrides are provided", () => {
    it("Then typed configuration values are returned", () => {
      expect(
        loadConfig({
          PORT: "8080",
          DB_PATH: ":memory:",
          LOG_LEVEL: "debug",
          CDR_TIMEOUT_MS: "2500",
          ALLOW_LIVE_SYNC: "false",
        }),
      ).toEqual({
        port: 8080,
        dbPath: ":memory:",
        logLevel: "debug",
        cdrTimeoutMs: 2500,
        allowLiveSync: false,
      });
    });
  });

  describe("Given invalid port or timeout values are configured", () => {
    it("Then configuration loading fails fast with a descriptive error", () => {
      expect(() => loadConfig({ PORT: "99999" })).toThrow(
        /Invalid application configuration.*PORT/,
      );
      expect(() => loadConfig({ CDR_TIMEOUT_MS: "50" })).toThrow(
        /Invalid application configuration.*CDR_TIMEOUT_MS/,
      );
    });
  });
});
