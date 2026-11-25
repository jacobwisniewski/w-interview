import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

describe("Fail-Fast Application Configuration", () => {
  describe("GIVEN no environment overrides are provided", () => {
    it("THEN safe local defaults are applied", () => {
      expect(loadConfig({})).toEqual({
        port: 3000,
        dbPath: "./data/cdr-monitor.db",
        logLevel: "info",
      });
    });
  });

  describe("GIVEN valid environment overrides are provided", () => {
    it("THEN typed configuration values are returned", () => {
      expect(
        loadConfig({
          PORT: "8080",
          DB_PATH: ":memory:",
          LOG_LEVEL: "debug",
        }),
      ).toEqual({
        port: 8080,
        dbPath: ":memory:",
        logLevel: "debug",
      });
    });
  });

  describe("GIVEN an invalid port or log level is configured", () => {
    it.each([
      { env: { PORT: "99999" }, field: "PORT" },
      { env: { LOG_LEVEL: "verbose" }, field: "LOG_LEVEL" },
    ])("THEN configuration loading fails fast citing $field", ({ env, field }) => {
      expect(() => loadConfig(env)).toThrow(
        new RegExp(`Invalid application configuration.*${field}`),
      );
    });
  });
});
