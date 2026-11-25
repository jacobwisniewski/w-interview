import { describe, expect, it } from "vitest";
import { deriveReviewReasons, deriveReviewStatus } from "../guardrails.js";

describe("Feature: Compliance-Safe Mortgage Disclosure Guardrails", () => {
  describe("Given headline and comparison rates for a mortgage product", () => {
    it.each([
      {
        caseName: "valid headline and comparison rates",
        headline: 6.19,
        comparison: 6.24,
        expectedReasons: [],
        expectedStatus: "READY",
      },
      {
        caseName: "missing comparison rate",
        headline: 6.19,
        comparison: null,
        expectedReasons: ["MISSING_COMPARISON_RATE"],
        expectedStatus: "MANUAL_REVIEW_REQUIRED",
      },
      {
        caseName: "out-of-bounds headline rate",
        headline: 35.0,
        comparison: 6.2,
        expectedReasons: ["RATE_OUT_OF_BOUNDS", "SUSPICIOUS_RATE_SPREAD"],
        expectedStatus: "MANUAL_REVIEW_REQUIRED",
      },
      {
        caseName: "suspicious spread between headline and comparison rate",
        headline: 9.5,
        comparison: 6.0,
        expectedReasons: ["SUSPICIOUS_RATE_SPREAD"],
        expectedStatus: "MANUAL_REVIEW_REQUIRED",
      },
      {
        caseName: "both rates missing",
        headline: null,
        comparison: null,
        expectedReasons: ["NO_VALID_LENDING_RATE", "MISSING_COMPARISON_RATE"],
        expectedStatus: "MANUAL_REVIEW_REQUIRED",
      },
    ])(
      "When evaluated for $caseName Then status is $expectedStatus with $expectedReasons",
      ({ headline, comparison, expectedReasons, expectedStatus }) => {
        const reasons = deriveReviewReasons(headline, comparison);
        expect(reasons).toEqual(expectedReasons);
        expect(deriveReviewStatus(reasons)).toBe(expectedStatus);
      },
    );
  });
});
