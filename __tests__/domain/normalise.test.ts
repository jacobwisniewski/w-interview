import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BankSnapshotSchema } from "../../src/cdr/schema.js";
import { validateAndNormaliseBatch } from "../../src/domain/normalise.js";

function readSnapshot(relPath: string) {
  return BankSnapshotSchema.parse(JSON.parse(readFileSync(join(process.cwd(), relPath), "utf8")));
}

describe("Feature: CDR Batch Validation and Normalisation", () => {
  describe("Given a bank snapshot containing an incomplete product and a malformed product", () => {
    const snapshot = readSnapshot("sample-data/snapshots/v1/example-bank.json");
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

    it("Then the incomplete product is flagged MANUAL_REVIEW_REQUIRED with fees and features preserved", () => {
      const flagged = result.valid[0];
      expect(flagged?.reviewStatus).toBe("MANUAL_REVIEW_REQUIRED");
      expect(flagged?.reviewReasons).toContain("MISSING_COMPARISON_RATE");
      expect(flagged?.annualFeeCents).toBe(39500);
      expect(flagged?.hasOffset).toBe(true);
    });
  });

  describe("Given all 41 real Australian bank snapshots in sample-data/snapshots/v1", () => {
    it("Then zero real bank products are quarantined and over 100 mortgages are normalised", () => {
      const dir = join(process.cwd(), "sample-data/snapshots/v1");
      const files = readdirSync(dir).filter(
        (f) => f.endsWith(".json") && f !== "example-bank.json",
      );
      const batches = files.map((file) => {
        const envelope = readSnapshot(`sample-data/snapshots/v1/${file}`);
        return validateAndNormaliseBatch(envelope.bankSlug, envelope.bankName, envelope.products);
      });

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
