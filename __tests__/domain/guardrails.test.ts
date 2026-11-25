import { describe, expect, it } from "vitest";
import { deriveReviewReasons, deriveReviewStatus } from "../../src/domain/guardrails.js";

describe("Feature: Compliance-Safe Mortgage Disclosure Guardrails", () => {
  describe("Given a mortgage with valid headline and comparison rates", () => {
    it("Then it is marked READY with zero review reasons", () => {
      const reasons = deriveReviewReasons(6.19, 6.24);
      expect(reasons).toEqual([]);
      expect(deriveReviewStatus(reasons)).toBe("READY");
    });
  });

  describe("Given a mortgage missing a comparison rate", () => {
    it("Then it abstains as MANUAL_REVIEW_REQUIRED with MISSING_COMPARISON_RATE", () => {
      const reasons = deriveReviewReasons(6.19, null);
      expect(reasons).toContain("MISSING_COMPARISON_RATE");
      expect(deriveReviewStatus(reasons)).toBe("MANUAL_REVIEW_REQUIRED");
    });
  });

  describe("Given a mortgage with out-of-bounds or suspiciously diverging rates", () => {
    it("Then out-of-bounds and spread guardrails flag MANUAL_REVIEW_REQUIRED", () => {
      expect(deriveReviewReasons(35.0, 6.2)).toContain("RATE_OUT_OF_BOUNDS");
      expect(deriveReviewReasons(9.5, 6.0)).toContain("SUSPICIOUS_RATE_SPREAD");
      expect(deriveReviewReasons(null, null)).toEqual([
        "NO_VALID_LENDING_RATE",
        "MISSING_COMPARISON_RATE",
      ]);
    });
  });
});
