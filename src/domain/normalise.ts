import {
  CdrProductDetailSchema,
  type CdrLendingRate,
  type CdrProductDetail,
} from "../cdr/schema.js";
import { deriveReviewReasons, deriveReviewStatus } from "./guardrails.js";
import {
  classifyRateType,
  parseCdrRateToPct,
  sumAnnualFeesCents,
  sumUpfrontFeesCents,
} from "./parsing.js";
import type { NormalisedProduct, ValidationBatchResult } from "./types.js";

export type {
  NormalisedProduct,
  PrimaryRateType,
  QuarantinedRecord,
  RateChange,
  ReviewStatus,
  ValidationBatchResult,
} from "./types.js";
export { computeRateDiffs } from "./diff.js";
export { parseAudToCents, parseCdrRateToPct } from "./parsing.js";

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
    reviewStatus: deriveReviewStatus(reviewReasons),
    reviewReasons,
    rawRateCount: product.lendingRates.length,
  };
}

export function validateAndNormaliseBatch(
  bankSlug: string,
  bankName: string,
  rawProducts: readonly unknown[],
): ValidationBatchResult {
  return rawProducts.reduce<ValidationBatchResult>(
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
