import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BankSnapshotSchema } from "../src/cdr/schema.js";
import { computeRateDiffs, validateAndNormaliseBatch } from "../src/domain/normalise.js";

function readSnapshot(relPath: string) {
  return BankSnapshotSchema.parse(JSON.parse(readFileSync(join(process.cwd(), relPath), "utf8")));
}

describe("Feature: CDR Mortgage Normalisation & Compliance Guardrails", () => {
  describe("Given a bank snapshot containing a product without a comparison rate and a malformed product", () => {
    const snapshot = readSnapshot("sample-data/snapshots/v1/example-bank.json");

    describe("When the batch is validated and normalised", () => {
      const result = validateAndNormaliseBatch(
        snapshot.bankSlug,
        snapshot.bankName,
        snapshot.products,
      );

      it("Then the malformed record is isolated into quarantine without failing valid siblings", () => {
        expect(result.valid).toHaveLength(1);
        expect(result.quarantined).toHaveLength(1);
        expect(result.quarantined[0]?.productId).toBe("ex-malformed-record");
        expect(result.quarantined[0]?.reason).toContain("lendingRates");
      });

      it("Then the incomplete product is flagged MANUAL_REVIEW_REQUIRED with fee and feature details preserved", () => {
        const flagged = result.valid[0];
        expect(flagged?.reviewStatus).toBe("MANUAL_REVIEW_REQUIRED");
        expect(flagged?.reviewReasons).toContain("MISSING_COMPARISON_RATE");
        expect(flagged?.annualFeeCents).toBe(39500);
        expect(flagged?.hasOffset).toBe(true);
      });
    });
  });

  describe("Given the real public CDR snapshots across 41 Australian banks", () => {
    const dir = join(process.cwd(), "sample-data/snapshots/v1");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "example-bank.json");

    describe("When every real bank snapshot is normalised", () => {
      const batches = files.map((file) => {
        const envelope = readSnapshot(`sample-data/snapshots/v1/${file}`);
        return validateAndNormaliseBatch(envelope.bankSlug, envelope.bankName, envelope.products);
      });

      it("Then zero real bank products are quarantined and over 100 mortgages are normalised", () => {
        const totalQuarantined = batches.reduce((sum, b) => sum + b.quarantined.length, 0);
        const totalValid = batches.reduce((sum, b) => sum + b.valid.length, 0);
        const totalReady = batches.reduce(
          (sum, b) => sum + b.valid.filter((p) => p.reviewStatus === "READY").length,
          0,
        );

        expect(files.length).toBeGreaterThanOrEqual(41);
        expect(totalQuarantined).toBe(0);
        expect(totalValid).toBeGreaterThanOrEqual(105);
        expect(totalReady).toBeGreaterThan(0);
      });
    });
  });

  describe("Given consecutive v1 and v2 snapshots where Up Bank raised rates by 15 bps", () => {
    const v1 = readSnapshot("sample-data/snapshots/v1/up.json");
    const v2 = readSnapshot("sample-data/snapshots/v2/up.json");

    describe("When rate diffs are computed between snapshots", () => {
      const diffs = computeRateDiffs(
        validateAndNormaliseBatch(v1.bankSlug, v1.bankName, v1.products).valid,
        validateAndNormaliseBatch(v2.bankSlug, v2.bankName, v2.products).valid,
      );

      it("Then a +15 bps headline and comparison rate change is reported", () => {
        expect(diffs).toHaveLength(1);
        expect(diffs[0]?.headlineDeltaBps).toBe(15);
        expect(diffs[0]?.comparisonDeltaBps).toBe(15);
      });
    });
  });
});
