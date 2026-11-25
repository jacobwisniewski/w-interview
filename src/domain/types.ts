export type ReviewStatus = "READY" | "MANUAL_REVIEW_REQUIRED";
export type PrimaryRateType = "VARIABLE" | "FIXED" | "OTHER";

export interface NormalisedProduct {
  readonly bankSlug: string;
  readonly bankName: string;
  readonly productId: string;
  readonly name: string;
  readonly description: string;
  readonly lastUpdated: string | null;
  readonly overviewUri: string | null;
  readonly rateType: PrimaryRateType;
  readonly headlineRatePct: number | null;
  readonly comparisonRatePct: number | null;
  readonly annualFeeCents: number;
  readonly upfrontFeeCents: number;
  readonly hasOffset: boolean;
  readonly hasRedraw: boolean;
  readonly reviewStatus: ReviewStatus;
  readonly reviewReasons: readonly string[];
  readonly rawRateCount: number;
}

export interface QuarantinedRecord {
  readonly bankSlug: string;
  readonly productId: string | null;
  readonly reason: string;
  readonly rawPayload: string;
}

export interface RateChange {
  readonly bankSlug: string;
  readonly bankName: string;
  readonly productId: string;
  readonly productName: string;
  readonly previousHeadlinePct: number | null;
  readonly currentHeadlinePct: number | null;
  readonly headlineDeltaBps: number | null;
  readonly previousComparisonPct: number | null;
  readonly currentComparisonPct: number | null;
  readonly comparisonDeltaBps: number | null;
}

export interface ValidationBatchResult {
  readonly valid: readonly NormalisedProduct[];
  readonly quarantined: readonly QuarantinedRecord[];
}
