import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BankSnapshotSchema } from "../../cdr/schema.js";
import { computeRateDiffs } from "../diff.js";
import { validateAndNormaliseBatch } from "../normalise.js";

function readSnapshot(relPath: string) {
  return BankSnapshotSchema.parse(JSON.parse(readFileSync(join(process.cwd(), relPath), "utf8")));
}

describe("Snapshot Rate Change Diffing", () => {
  describe("GIVEN consecutive snapshots where Up Bank raised rates by 15 bps", () => {
    it("THEN a +15 bps headline and comparison rate change is detected", () => {
      const baseline = readSnapshot("sample-data/snapshots/v1/up.json");
      const previous = validateAndNormaliseBatch(
        baseline.bankSlug,
        baseline.bankName,
        baseline.products,
      ).valid;
      const updated = previous.map((product) => ({
        ...product,
        headlineRatePct: Number((product.headlineRatePct + 0.15).toFixed(4)),
        comparisonRatePct:
          product.comparisonRatePct === null
            ? null
            : Number((product.comparisonRatePct + 0.15).toFixed(4)),
      }));

      const diffs = computeRateDiffs(previous, updated);

      expect(diffs).toHaveLength(1);
      expect(diffs[0]?.headlineDeltaBps).toBe(15);
      expect(diffs[0]?.comparisonDeltaBps).toBe(15);
    });
  });

  describe("GIVEN two identical snapshots with unchanged rates", () => {
    it("THEN zero rate changes are emitted", () => {
      const v1 = readSnapshot("sample-data/snapshots/v1/up.json");
      const products = validateAndNormaliseBatch(v1.bankSlug, v1.bankName, v1.products).valid;
      expect(computeRateDiffs(products, products)).toEqual([]);
    });
  });
});
