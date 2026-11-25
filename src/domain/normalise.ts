import {
  CdrProductDetailSchema,
  type CdrLendingRate,
  type CdrProductDetail,
} from "../cdr/schema.js";

export type ReviewStatus = "READY" | "MANUAL_REVIEW_REQUIRED";
export type PrimaryRateType = "VARIABLE" | "FIXED" | "OTHER";

export interface NormalisedProduct {
  bankSlug: string;
  bankName: string;
  productId: string;
  name: string;
  description: string;
  lastUpdated: string | null;
  overviewUri: string | null;
  rateType: PrimaryRateType;
  headlineRatePct: number | null;
  comparisonRatePct: number | null;
  annualFeeCents: number;
  upfrontFeeCents: number;
  hasOffset: boolean;
  hasRedraw: boolean;
  reviewStatus: ReviewStatus;
  reviewReasons: string[];
  rawRateCount: number;
}

export interface QuarantinedRecord {
  bankSlug: string;
  productId: string | null;
  reason: string;
  rawPayload: string;
}

export interface RateChange {
  bankSlug: string;
  bankName: string;
  productId: string;
  productName: string;
  previousHeadlinePct: number | null;
  currentHeadlinePct: number | null;
  headlineDeltaBps: number | null;
  previousComparisonPct: number | null;
  currentComparisonPct: number | null;
  comparisonDeltaBps: number | null;
}

const MIN_SANE_RATE_PCT = 0.01;
const MAX_SANE_RATE_PCT = 25.0;

/**
 * Parses a CDR decimal rate string (e.g. "0.0619") into percentage points (e.g. 6.19).
 * Returns null if the value is missing or non-numeric.
 */
export function parseCdrRateToPct(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  // CDR rates are decimal fractions (0.0619 = 6.19%). Round to 4 decimal places.
  return Math.round(parsed * 100 * 10000) / 10000;
}

/**
 * Parses a CDR dollar string (e.g. "395.00") into integer cents (39500).
 */
export function parseAudToCents(raw: string | null | undefined): number {
  if (!raw) return 0;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
}

function classifyRateType(lendingRateType: string): PrimaryRateType {
  const upper = lendingRateType.toUpperCase();
  if (upper.includes("VARIABLE")) return "VARIABLE";
  if (upper.includes("FIXED")) return "FIXED";
  return "OTHER";
}

function selectPrimaryRate(rates: CdrLendingRate[]): CdrLendingRate | null {
  const numericRates = rates.filter((r) => parseCdrRateToPct(r.rate) !== null);
  if (numericRates.length === 0) return null;

  // Prefer standard Owner-Occupied Principal & Interest variable rates for fair comparison
  const scored = numericRates.map((r) => {
    let score = 0;
    const type = r.lendingRateType.toUpperCase();
    if (type === "VARIABLE") score += 40;
    else if (type === "FIXED") score += 20;
    if (r.loanPurpose?.toUpperCase() === "OWNER_OCCUPIED") score += 25;
    if (r.repaymentType?.toUpperCase() === "PRINCIPAL_AND_INTEREST") score += 20;
    if (parseCdrRateToPct(r.comparisonRate) !== null) score += 15;
    const pct = parseCdrRateToPct(r.rate) ?? 999;
    return { rate: r, score, pct };
  });

  scored.sort((a, b) => b.score - a.score || a.pct - b.pct);
  return scored[0]?.rate ?? null;
}

export function normaliseCdrProduct(
  bankSlug: string,
  bankName: string,
  product: CdrProductDetail,
): NormalisedProduct {
  const primary = selectPrimaryRate(product.lendingRates);
  const headlineRatePct = primary ? parseCdrRateToPct(primary.rate) : null;
  const comparisonRatePct = primary ? parseCdrRateToPct(primary.comparisonRate) : null;
  const rateType: PrimaryRateType = primary ? classifyRateType(primary.lendingRateType) : "OTHER";

  let annualFeeCents = 0;
  let upfrontFeeCents = 0;
  for (const fee of product.fees) {
    const cents = parseAudToCents(fee.amount);
    const feeType = fee.feeType.toUpperCase();
    if (feeType === "PERIODIC" && fee.additionalValue?.toUpperCase() === "P1Y") {
      annualFeeCents += cents;
    } else if (feeType === "UPFRONT") {
      upfrontFeeCents += cents;
    }
  }

  const featureTypes = new Set(product.features.map((f) => f.featureType.toUpperCase()));
  const hasOffset = featureTypes.has("OFFSET");
  const hasRedraw = featureTypes.has("REDRAW");

  // Compliance-safe abstain checks: flag ambiguous or incomplete mortgage disclosures
  const reviewReasons: string[] = [];
  if (headlineRatePct === null) {
    reviewReasons.push("NO_VALID_LENDING_RATE");
  } else if (headlineRatePct < MIN_SANE_RATE_PCT || headlineRatePct > MAX_SANE_RATE_PCT) {
    reviewReasons.push("RATE_OUT_OF_BOUNDS");
  }

  if (comparisonRatePct === null) {
    reviewReasons.push("MISSING_COMPARISON_RATE");
  } else if (comparisonRatePct < MIN_SANE_RATE_PCT || comparisonRatePct > MAX_SANE_RATE_PCT) {
    reviewReasons.push("COMPARISON_RATE_OUT_OF_BOUNDS");
  }

  if (
    headlineRatePct !== null &&
    comparisonRatePct !== null &&
    headlineRatePct - comparisonRatePct > 2.0
  ) {
    reviewReasons.push("SUSPICIOUS_RATE_SPREAD");
  }

  const reviewStatus: ReviewStatus = reviewReasons.length > 0 ? "MANUAL_REVIEW_REQUIRED" : "READY";

  return {
    bankSlug,
    bankName,
    productId: product.productId,
    name: product.name,
    description: product.description,
    lastUpdated: product.lastUpdated ?? null,
    overviewUri: product.additionalInformation?.overviewUri ?? null,
    rateType,
    headlineRatePct,
    comparisonRatePct,
    annualFeeCents,
    upfrontFeeCents,
    hasOffset,
    hasRedraw,
    reviewStatus,
    reviewReasons,
    rawRateCount: product.lendingRates.length,
  };
}

/**
 * Validates and normalises a batch of raw CDR product payloads.
 * Malformed payloads are isolated into `quarantined` without aborting valid siblings.
 */
export function validateAndNormaliseBatch(
  bankSlug: string,
  bankName: string,
  rawProducts: unknown[],
): { valid: NormalisedProduct[]; quarantined: QuarantinedRecord[] } {
  const valid: NormalisedProduct[] = [];
  const quarantined: QuarantinedRecord[] = [];

  for (const raw of rawProducts) {
    const parsed = CdrProductDetailSchema.safeParse(raw);
    if (!parsed.success) {
      const maybeId =
        typeof raw === "object" &&
        raw !== null &&
        "productId" in raw &&
        typeof (raw as { productId?: unknown }).productId === "string"
          ? (raw as { productId: string }).productId
          : null;
      const reason = parsed.error.issues
        .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
        .join("; ");
      quarantined.push({
        bankSlug,
        productId: maybeId,
        reason,
        rawPayload: JSON.stringify(raw),
      });
      continue;
    }

    valid.push(normaliseCdrProduct(bankSlug, bankName, parsed.data));
  }

  return { valid, quarantined };
}

/**
 * Computes basis-point rate changes between two snapshots of products.
 */
export function computeRateDiffs(
  previous: NormalisedProduct[],
  current: NormalisedProduct[],
): RateChange[] {
  const prevByKey = new Map(previous.map((p) => [`${p.bankSlug}::${p.productId}`, p]));
  const changes: RateChange[] = [];

  for (const curr of current) {
    const prev = prevByKey.get(`${curr.bankSlug}::${curr.productId}`);
    if (!prev) continue;

    const headlineDeltaBps =
      prev.headlineRatePct !== null && curr.headlineRatePct !== null
        ? Math.round((curr.headlineRatePct - prev.headlineRatePct) * 100)
        : null;
    const comparisonDeltaBps =
      prev.comparisonRatePct !== null && curr.comparisonRatePct !== null
        ? Math.round((curr.comparisonRatePct - prev.comparisonRatePct) * 100)
        : null;

    if (
      (headlineDeltaBps !== null && headlineDeltaBps !== 0) ||
      (comparisonDeltaBps !== null && comparisonDeltaBps !== 0)
    ) {
      changes.push({
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
      });
    }
  }

  return changes;
}
