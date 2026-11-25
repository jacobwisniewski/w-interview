import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BankSnapshotSchema } from "../../cdr/schema.js";
import { SqliteProductRepository } from "../sqlite-repository.js";
import { validateAndNormaliseBatch } from "../../domain/normalise.js";

function loadFixture(relPath: string) {
  const envelope = BankSnapshotSchema.parse(
    JSON.parse(readFileSync(join(process.cwd(), relPath), "utf8")),
  );
  const batch = validateAndNormaliseBatch(envelope.bankSlug, envelope.bankName, envelope.products);
  return { envelope, batch };
}

function withInMemoryRepo<T>(run: (repo: SqliteProductRepository) => T): T {
  const repo = new SqliteProductRepository(":memory:");
  try {
    return run(repo);
  } finally {
    repo.close();
  }
}

describe("Feature: Transactional SQLite Snapshot Persistence", () => {
  describe("Given valid and edge-case bank snapshots are ingested", () => {
    it("Then products can be filtered by review status and malformed payloads are audited in quarantine", () => {
      withInMemoryRepo((repo) => {
        const up = loadFixture("sample-data/snapshots/v1/up.json");
        const example = loadFixture("sample-data/snapshots/v1/example-bank.json");

        repo.recordSnapshot({
          ...up.envelope,
          source: "snapshot",
          products: up.batch.valid,
          quarantined: up.batch.quarantined,
        });
        repo.recordSnapshot({
          ...example.envelope,
          source: "snapshot",
          products: example.batch.valid,
          quarantined: example.batch.quarantined,
        });

        expect(repo.listLatestProducts()).toHaveLength(2);
        expect(repo.listLatestProducts({ reviewStatus: "READY" })).toHaveLength(1);
        expect(repo.listLatestProducts({ reviewStatus: "MANUAL_REVIEW_REQUIRED" })).toHaveLength(1);
        expect(repo.listQuarantined()).toHaveLength(1);
      });
    });
  });

  describe("Given a snapshot batch violates a database uniqueness constraint mid-write", () => {
    it("Then the entire transaction rolls back leaving zero partial products or bank statuses", () => {
      withInMemoryRepo((repo) => {
        const up = loadFixture("sample-data/snapshots/v1/up.json");
        const dupProduct = up.batch.valid[0]!;

        expect(() =>
          repo.recordSnapshot({
            ...up.envelope,
            source: "snapshot",
            products: [dupProduct, dupProduct],
            quarantined: [],
          }),
        ).toThrow();

        expect(repo.listLatestProducts()).toHaveLength(0);
        expect(repo.listBankStatuses()).toHaveLength(0);
      });
    });
  });

  describe("Given a bank already has a verified snapshot and a later live sync fails", () => {
    it("Then the bank is marked degraded while readers continue seeing the last verified snapshot", () => {
      withInMemoryRepo((repo) => {
        const up = loadFixture("sample-data/snapshots/v1/up.json");
        repo.recordSnapshot({
          ...up.envelope,
          source: "snapshot",
          products: up.batch.valid,
          quarantined: [],
        });

        repo.recordDegradedSync({
          bankSlug: up.envelope.bankSlug,
          bankName: up.envelope.bankName,
          sourceUrl: up.envelope.sourceUrl,
          cdrVersion: up.envelope.cdrVersion,
          source: "live",
          attemptedAt: "2026-11-25T11:00:00Z",
          errorMessage: "HTTP 406 UnsupportedVersion",
        });

        const status = repo.listBankStatuses()[0];
        expect(status?.degraded).toBe(true);
        expect(status?.lastError).toContain("406");
        expect(repo.listLatestProducts({ bankSlug: "up" })).toHaveLength(1);
      });
    });
  });

  describe("Given two consecutive verified snapshots exist for a bank", () => {
    it("Then rate changes between the two snapshots are surfaced in basis points", () => {
      withInMemoryRepo((repo) => {
        const upV1 = loadFixture("sample-data/snapshots/v1/up.json");
        const upV2 = loadFixture("sample-data/snapshots/v2/up.json");

        repo.recordSnapshot({
          ...upV1.envelope,
          source: "snapshot",
          products: upV1.batch.valid,
          quarantined: [],
        });
        repo.recordSnapshot({
          ...upV2.envelope,
          source: "snapshot",
          products: upV2.batch.valid,
          quarantined: [],
        });

        const changes = repo.getRateChanges();
        expect(changes).toHaveLength(1);
        expect(changes[0]?.headlineDeltaBps).toBe(15);
      });
    });
  });
});
