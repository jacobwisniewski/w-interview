import { describe, expect, it } from "vitest";
import { classifyRateType, parseAudToCents, parseCdrRateToPct } from "../parsing.js";

describe("Feature: CDR Rate and Currency Parsing", () => {
  describe("Given a CDR decimal interest rate string", () => {
    it.each([
      { input: "0.0619", expected: 6.19 },
      { input: "0.05995", expected: 5.995 },
      { input: null, expected: null },
      { input: undefined, expected: null },
      { input: "   ", expected: null },
      { input: "invalid", expected: null },
    ])("When parsed from $input Then it returns $expected", ({ input, expected }) => {
      expect(parseCdrRateToPct(input)).toBe(expected);
    });
  });

  describe("Given an AUD dollar fee string", () => {
    it.each([
      { input: "395.00", expected: 39500 },
      { input: "12.50", expected: 1250 },
      { input: "0", expected: 0 },
      { input: "-5.00", expected: 0 },
      { input: undefined, expected: 0 },
      { input: "not-a-number", expected: 0 },
    ])("When parsed from $input Then it returns $expected cents", ({ input, expected }) => {
      expect(parseAudToCents(input)).toBe(expected);
    });
  });

  describe("Given a raw CDR lendingRateType string", () => {
    it.each([
      { input: "VARIABLE", expected: "VARIABLE" },
      { input: "FIXED", expected: "FIXED" },
      { input: "INTRODUCTORY", expected: "OTHER" },
    ])("When classified from $input Then it returns $expected", ({ input, expected }) => {
      expect(classifyRateType(input)).toBe(expected);
    });
  });
});
