import { describe, expect, it } from "vitest";
import { classifyRateType, parseAudToCents, parseCdrRateToPct } from "../../src/domain/parsing.js";

describe("Feature: CDR Rate and Currency Parsing", () => {
  describe("Given CDR decimal interest rate strings", () => {
    it("Then valid decimals convert to percentage points and invalid inputs return null", () => {
      expect(parseCdrRateToPct("0.0619")).toBe(6.19);
      expect(parseCdrRateToPct("0.05995")).toBe(5.995);
      expect(parseCdrRateToPct(null)).toBeNull();
      expect(parseCdrRateToPct("invalid")).toBeNull();
    });
  });

  describe("Given AUD dollar fee strings", () => {
    it("Then non-negative amounts convert to integer cents and invalid or negative values default to 0", () => {
      expect(parseAudToCents("395.00")).toBe(39500);
      expect(parseAudToCents("12.50")).toBe(1250);
      expect(parseAudToCents("-5.00")).toBe(0);
      expect(parseAudToCents(undefined)).toBe(0);
    });
  });

  describe("Given raw CDR lendingRateType strings", () => {
    it("Then they classify into VARIABLE, FIXED, or OTHER", () => {
      expect(classifyRateType("VARIABLE")).toBe("VARIABLE");
      expect(classifyRateType("FIXED")).toBe("FIXED");
      expect(classifyRateType("INTRODUCTORY")).toBe("OTHER");
    });
  });
});
