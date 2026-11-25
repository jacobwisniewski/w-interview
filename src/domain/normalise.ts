import {
  CdrProductDetailSchema,
  type CdrFee,
  type CdrLendingRate,
  type CdrProductDetail,
} from "../cdr/schema.js";

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

const MIN_SANE_RATE_PCT = 0.01;
const MAX_SANE_RATE_PCT = 25.0;

export function parseCdrRateToPct(raw: string | null | undefined): number | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.round(parsed * 100 * 10000) / 10000 : null;
}

export function parseAudToCents(raw: string | null | undefined): number {
  const trimmed = raw?.trim();
  if (!trimmed) return 0;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : 0;
}

function classifyRateType(lendingRateType: string): PrimaryRateType {
  const upper = lendingRateType.toUpperCase();
  if (upper.includes("VARIABLE")) return "VARIABLE";
  if (upper.includes("FIXED")) return "FIXED";
  return "OTHER";
}

function scoreLendingRate(rate: CdrLendingRate): number {
  const type = rate.lendingRateType.toUpperCase();
  const typeScore = type === "VARIABLE" ? 40 : type === "FIXED" ? 20 : 0;
  const purposeScore = rate.loanPurpose?.toUpperCase() === "OWNER_OCCUPIED" ? 25 : 0;
  const repaymentScore = rate.repaymentType?.toUpperCase() === "PRINCIPAL_AND_INTEREST" ? 20 : 0;
  const comparisonScore = parseCdrRateToPct(rate.comparisonRate) !== null ? 15 : 0;
  return typeScore + purposeScore + repaymentScore + comparisonScore;
}

function selectPrimaryRate(rates: readonly CdrLendingRate[]): CdrLendingRate | null {
  const ranked = rates
    .filter((r) => parseCdrRateToPct(r.rate) !== null)
    .map((rate) => ({
      rate,
      score: scoreLendingRate(rate),
      pct: parseCdrRateToPct(rate.rate) ?? 999,
    }))
    .toSorted((a, b) => b.score - a.score || a.pct - b.pct);

  return ranked[0]?.rate ?? null;
}

function sumAnnualFeesCents(fees: readonly CdrFee[]): number {
  return fees
    .filter(
      (fee) =>
        fee.feeType.toUpperCase() === "PERIODIC" && fee.additionalValue?.toUpperCase() === "P1Y",
    )
    .reduce((sum, fee) => sum + parseAudToCents(fee.amount), 0);
}

function sumUpfrontFeesCents(fees: readonly CdrFee[]): number {
  return fees
    .filter((fee) => fee.feeType.toUpperCase() === "UPFRONT")
    .reduce((sum, fee) => sum + parseAudToCents(fee.amount), 0);
}

function isOutOfBounds(pct: number): boolean {
  return pct < MIN_SANE_RATE_PCT || pct > MAX_SANE_RATE_PCT;
}

function deriveReviewReasons(
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
    headlineRatePct - comparisonRatePct > 2.0
      ? ["SUSPICIOUS_RATE_SPREAD"]
      : [];

  return [...headlineReason, ...comparisonReason, ...spreadReason];
}

function extractRawProductId(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null || !("productId" in raw)) return null;
  const candidate = (raw as { readonly productId?: unknown }).productId;
  return typeof candidate === "string" ? candidate : null;
}

export function normaliseCdrProduct(
  bankSlug: string,
  bankName: string,
  product: CdrProductDetail,
): NormalisedProduct {
  const primary = selectPrimaryRate(product.lendingRates);
  const headlineRatePct = primary ? parseCdrRateToPct(primary.rate) : null;
  const comparisonRatePct = primary ? parseCdrRateToPct(primary.comparisonRate) : null;
  const featureTypes = new Set(product.features.map((f) => f.featureType.toUpperCase()));
  const reviewReasons = deriveReviewReasons(headlineRatePct, comparisonRatePct);

  return {
    bankSlug,
    bankName,
    productId: product.productId,
    name: product.name,
    description: product.description,
    lastUpdated: product.lastUpdated ?? null,
    overviewUri: product.additionalInformation?.overviewUri ?? null,
    rateType: primary ? classifyRateType(primary.lendingRateType) : "OTHER",
    headlineRatePct,
    comparisonRatePct,
    annualFeeCents: sumAnnualFeesCents(product.fees),
    upfrontFeeCents: sumUpfrontFeesCents(product.fees),
    hasOffset: featureTypes.has("OFFSET"),
    hasRedraw: featureTypes.has("REDRAW"),
    reviewStatus: reviewReasons.length > 0 ? "MANUAL_REVIEW_REQUIRED" : "READY",
    reviewReasons,
    rawRateCount: product.lendingRates.length,
  };
}

export function validateAndNormaliseBatch(
  bankSlug: string,
  bankName: string,
  rawProducts: readonly unknown[],
): {
  readonly valid: readonly NormalisedProduct[];
  readonly quarantined: readonly QuarantinedRecord[];
} {
  return rawProducts.reduce<{
    readonly valid: readonly NormalisedProduct[];
    readonly quarantined: readonly QuarantinedRecord[];
  }>(
    (acc, raw) => {
      const parsed = CdrProductDetailSchema.safeParse(raw);
      if (!parsed.success) {
        const reason = parsed.error.issues
          .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
          .join("; ");
        return {
          valid: acc.valid,
          quarantined: [
            ...acc.quarantined,
            {
              bankSlug,
              productId: extractRawProductId(raw),
              reason,
              rawPayload: JSON.stringify(raw),
            },
          ],
        };
      }
      return {
        valid: [...acc.valid, normaliseCdrProduct(bankSlug, bankName, parsed.data)],
        quarantined: acc.quarantined,
      };
    },
    { valid: [], quarantined: [] },
  );
}

function deltaBps(prev: number | null, curr: number | null): number | null {
  return prev !== null && curr !== null ? Math.round((curr - prev) * 100) : null;
}

export function computeRateDiffs(
  previous: readonly NormalisedProduct[],
  current: readonly NormalisedProduct[],
): readonly RateChange[] {
  const prevByKey = new Map(previous.map((p) => [`${p.bankSlug}::${p.productId}`, p]));

  return current.flatMap((curr): readonly RateChange[] => {
    const prev = prevByKey.get(`${curr.bankSlug}::${curr.productId}`);
    if (!prev) return [];

    const headlineDeltaBps = deltaBps(prev.headlineRatePct, curr.headlineRatePct);
    const comparisonDeltaBps = deltaBps(prev.comparisonRatePct, curr.comparisonRatePct);
    const hasChange =
      (headlineDeltaBps !== null && headlineDeltaBps !== 0) ||
      (comparisonDeltaBps !== null && comparisonDeltaBps !== 0);

    return hasChange
      ? [
          {
            bankSlug: curr.bankSlug,
            bankName: curr.bankName,
            productId: curr.productId,
            productName: curr.name,
            previousHeadlinePct: prev.headlineRatePct,
            currentHeadlinePct: curr.headlineRatePct,
            headlineDeltaBps,
            previousComparisonPct: prev.comparisonRatePct,
            currentComparisonPct: curr.comparisonRatePct,
            comparisonDeltaBps,
          },
        ]
      : [];
  });
}
