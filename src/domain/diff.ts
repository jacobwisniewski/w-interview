import type { NormalisedProduct, RateChange } from "./types.js";

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
