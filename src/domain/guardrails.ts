import type { ReviewStatus } from "./types.js";

const MIN_SANE_RATE_PCT = 0.01;
const MAX_SANE_RATE_PCT = 25.0;
const MAX_HEADLINE_OVER_COMPARISON_SPREAD = 2.0;

function isOutOfBounds(pct: number): boolean {
  return pct < MIN_SANE_RATE_PCT || pct > MAX_SANE_RATE_PCT;
}

export function deriveReviewReasons(
  headlineRatePct: number | null,
  comparisonRatePct: number | null,
): readonly string[] {
  const headlineReason =
    headlineRatePct === null
      ? ["NO_VALID_LENDING_RATE"]
      : isOutOfBounds(headlineRatePct)
        ? ["RATE_OUT_OF_BOUNDS"]
        : [];

  const comparisonReason =
    comparisonRatePct === null
      ? ["MISSING_COMPARISON_RATE"]
      : isOutOfBounds(comparisonRatePct)
        ? ["COMPARISON_RATE_OUT_OF_BOUNDS"]
        : [];

  const spreadReason =
    headlineRatePct !== null &&
    comparisonRatePct !== null &&
    headlineRatePct - comparisonRatePct > MAX_HEADLINE_OVER_COMPARISON_SPREAD
      ? ["SUSPICIOUS_RATE_SPREAD"]
      : [];

  return [...headlineReason, ...comparisonReason, ...spreadReason];
}

export function deriveReviewStatus(reasons: readonly string[]): ReviewStatus {
  return reasons.length > 0 ? "MANUAL_REVIEW_REQUIRED" : "READY";
}
