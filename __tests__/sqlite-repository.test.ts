import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BankSnapshotSchema } from "../src/cdr/schema.js";
import { SqliteProductRepository } from "../src/db/sqlite-repository.js";
import { validateAndNormaliseBatch } from "../src/domain/normalise.js";

describe("SqliteProductRepository", () => {
  let repo: SqliteProductRepository | null = null;

  afterEach(() => {
    repo?.close();
    repo = null;
  });

  function loadFixture(relPath: string) {
    const raw = JSON.parse(readFileSync(join(process.cwd(), relPath), "utf8"));
    const envelope = BankSnapshotSchema.parse(raw);
    const batch = validateAndNormaliseBatch(
      envelope.bankSlug,
      envelope.bankName,
      envelope.products,
    );
    return { envelope, batch };
  }

  it("persists snapshots atomically, supports filtering, and tracks quarantined records", () => {
    repo = new SqliteProductRepository(":memory:");
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

    const all = repo.listLatestProducts();
    expect(all).toHaveLength(2);

    const readyOnly = repo.listLatestProducts({ reviewStatus: "READY" });
    expect(readyOnly).toHaveLength(1);
    expect(readyOnly[0]?.bankSlug).toBe("up");

    const manualOnly = repo.listLatestProducts({ reviewStatus: "MANUAL_REVIEW_REQUIRED" });
    expect(manualOnly).toHaveLength(1);
    expect(manualOnly[0]?.bankSlug).toBe("example-bank");

    const quarantined = repo.listQuarantined();
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]?.productId).toBe("ex-malformed-record");
  });

  it("rolls back entire snapshot transaction if a duplicate productId constraint fails mid-batch", () => {
    repo = new SqliteProductRepository(":memory:");
    const up = loadFixture("sample-data/snapshots/v1/up.json");
    const dupProduct = up.batch.valid[0]!;

    expect(() =>
      repo!.recordSnapshot({
        ...up.envelope,
        source: "snapshot",
        // Deliberately duplicate productId to trigger UNIQUE(sync_run_id, bank_slug, product_id) mid-batch
        products: [dupProduct, dupProduct],
        quarantined: [],
      }),
    ).toThrow();

    // Atomic rollback: zero products and zero bank_status rows persisted
    expect(repo.listLatestProducts()).toHaveLength(0);
    expect(repo.listBankStatuses()).toHaveLength(0);
  });

  it("preserves last good snapshot when a subsequent live sync degrades", () => {
    repo = new SqliteProductRepository(":memory:");
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

    const statuses = repo.listBankStatuses();
    expect(statuses[0]?.degraded).toBe(true);
    expect(statuses[0]?.lastError).toContain("406");
    // Readers still see the last verified snapshot cleanly
    expect(repo.listLatestProducts({ bankSlug: "up" })).toHaveLength(1);
  });

  it("computes basis-point rate changes between consecutive OK snapshots", () => {
    repo = new SqliteProductRepository(":memory:");
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
    expect(changes[0]?.bankSlug).toBe("up");
    expect(changes[0]?.headlineDeltaBps).toBe(15);
  });
});
