import type { CdrFee } from "../cdr/schema.js";
import type { PrimaryRateType } from "./types.js";

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

export function classifyRateType(lendingRateType: string): PrimaryRateType {
  const upper = lendingRateType.toUpperCase();
  if (upper.includes("VARIABLE")) return "VARIABLE";
  if (upper.includes("FIXED")) return "FIXED";
  return "OTHER";
}

export function sumAnnualFeesCents(fees: readonly CdrFee[]): number {
  return fees
    .filter(
      (fee) =>
        fee.feeType.toUpperCase() === "PERIODIC" && fee.additionalValue?.toUpperCase() === "P1Y",
    )
    .reduce((sum, fee) => sum + parseAudToCents(fee.amount), 0);
}

export function sumUpfrontFeesCents(fees: readonly CdrFee[]): number {
  return fees
    .filter((fee) => fee.feeType.toUpperCase() === "UPFRONT")
    .reduce((sum, fee) => sum + parseAudToCents(fee.amount), 0);
}
