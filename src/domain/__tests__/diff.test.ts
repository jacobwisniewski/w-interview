import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BankSnapshotSchema } from "../../cdr/schema.js";
import { computeRateDiffs } from "../diff.js";
import { validateAndNormaliseBatch } from "../normalise.js";

function readSnapshot(relPath: string) {
  return BankSnapshotSchema.parse(JSON.parse(readFileSync(join(process.cwd(), relPath), "utf8")));
}

describe("Feature: Snapshot Rate Change Diffing", () => {
  describe("Given consecutive v1 and v2 snapshots where Up Bank raised rates by 15 bps", () => {
    it("Then a +15 bps headline and comparison rate change is detected", () => {
      const v1 = readSnapshot("sample-data/snapshots/v1/up.json");
      const v2 = readSnapshot("sample-data/snapshots/v2/up.json");

      const diffs = computeRateDiffs(
        validateAndNormaliseBatch(v1.bankSlug, v1.bankName, v1.products).valid,
        validateAndNormaliseBatch(v2.bankSlug, v2.bankName, v2.products).valid,
      );

      expect(diffs).toHaveLength(1);
      expect(diffs[0]?.headlineDeltaBps).toBe(15);
      expect(diffs[0]?.comparisonDeltaBps).toBe(15);
    });
  });

  describe("Given two identical snapshots with unchanged rates", () => {
    it("Then zero rate changes are emitted", () => {
      const v1 = readSnapshot("sample-data/snapshots/v1/up.json");
      const products = validateAndNormaliseBatch(v1.bankSlug, v1.bankName, v1.products).valid;
      expect(computeRateDiffs(products, products)).toEqual([]);
    });
  });
});
