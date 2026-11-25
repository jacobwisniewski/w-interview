import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BankSnapshotSchema } from "../src/cdr/schema.js";
import {
  computeRateDiffs,
  parseAudToCents,
  parseCdrRateToPct,
  validateAndNormaliseBatch,
} from "../src/domain/normalise.js";

describe("CDR rate and currency parsing", () => {
  it("converts CDR decimal rate strings into percentage points", () => {
    expect(parseCdrRateToPct("0.0619")).toBe(6.19);
    expect(parseCdrRateToPct("0.05995")).toBe(5.995);
    expect(parseCdrRateToPct(null)).toBeNull();
    expect(parseCdrRateToPct("not-a-rate")).toBeNull();
  });

  it("converts AUD dollar strings into integer cents safely", () => {
    expect(parseAudToCents("395.00")).toBe(39500);
    expect(parseAudToCents("12.50")).toBe(1250);
    expect(parseAudToCents("-10.00")).toBe(0);
    expect(parseAudToCents(undefined)).toBe(0);
  });
});

describe("validateAndNormaliseBatch", () => {
  it("quarantines malformed payloads while keeping valid siblings and flagging missing comparisonRate", () => {
    const raw = JSON.parse(
      readFileSync(join(process.cwd(), "sample-data/snapshots/v1/example-bank.json"), "utf8"),
    );
    const envelope = BankSnapshotSchema.parse(raw);
    const { valid, quarantined } = validateAndNormaliseBatch(
      envelope.bankSlug,
      envelope.bankName,
      envelope.products,
    );

    expect(valid).toHaveLength(1);
    expect(quarantined).toHaveLength(1);

    const flagged = valid[0];
    expect(flagged?.productId).toBe("ex-missing-comparison-rate");
    expect(flagged?.reviewStatus).toBe("MANUAL_REVIEW_REQUIRED");
    expect(flagged?.reviewReasons).toContain("MISSING_COMPARISON_RATE");
    expect(flagged?.annualFeeCents).toBe(39500);
    expect(flagged?.hasOffset).toBe(true);

    expect(quarantined[0]?.productId).toBe("ex-malformed-record");
    expect(quarantined[0]?.reason).toContain("lendingRates");
  });

  it("parses all real AU CDR bank snapshots in sample-data/snapshots/v1 cleanly", () => {
    const dir = join(process.cwd(), "sample-data/snapshots/v1");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "example-bank.json");
    expect(files.length).toBeGreaterThanOrEqual(40);

    let totalValid = 0;
    let totalReady = 0;
    for (const file of files) {
      const envelope = BankSnapshotSchema.parse(JSON.parse(readFileSync(join(dir, file), "utf8")));
      const { valid, quarantined } = validateAndNormaliseBatch(
        envelope.bankSlug,
        envelope.bankName,
        envelope.products,
      );
      expect(quarantined).toHaveLength(0);
      totalValid += valid.length;
      totalReady += valid.filter((p) => p.reviewStatus === "READY").length;
    }

    expect(totalValid).toBeGreaterThanOrEqual(100);
    expect(totalReady).toBeGreaterThan(0);
  });
});

describe("computeRateDiffs", () => {
  it("computes accurate basis-point deltas between v1 and v2 snapshots", () => {
    const v1 = BankSnapshotSchema.parse(
      JSON.parse(readFileSync(join(process.cwd(), "sample-data/snapshots/v1/up.json"), "utf8")),
    );
    const v2 = BankSnapshotSchema.parse(
      JSON.parse(readFileSync(join(process.cwd(), "sample-data/snapshots/v2/up.json"), "utf8")),
    );

    const prev = validateAndNormaliseBatch(v1.bankSlug, v1.bankName, v1.products).valid;
    const curr = validateAndNormaliseBatch(v2.bankSlug, v2.bankName, v2.products).valid;
    const diffs = computeRateDiffs(prev, curr);

    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.headlineDeltaBps).toBe(15);
    expect(diffs[0]?.comparisonDeltaBps).toBe(15);
  });
});
