import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSqliteProductRepository } from "../../db/sqlite-repository.js";
import { createLogger } from "../../logger.js";
import { ingestSnapshotDirectory } from "../loader.js";

const silentLogger = createLogger("error", {}, () => {});

function withRepo<T>(run: (repo: ReturnType<typeof createSqliteProductRepository>) => T): T {
  const repo = createSqliteProductRepository(":memory:");
  try {
    return run(repo);
  } finally {
    repo.close();
  }
}

describe("CDR Snapshot Directory Loader", () => {
  describe("GIVEN the bundled v1 snapshot directory with 41 real AU banks and 1 synthetic fixture", () => {
    it("THEN all valid mortgages are persisted and the malformed fixture record is quarantined", () => {
      withRepo((repo) => {
        const summary = ingestSnapshotDirectory(
          repo,
          silentLogger,
          join(process.cwd(), "sample-data/snapshots/v1"),
          "v1",
        );

        expect(summary.mode).toBe("snapshot");
        expect(summary.banksProcessed).toBeGreaterThanOrEqual(42);
        expect(summary.validProducts).toBeGreaterThanOrEqual(105);
        expect(summary.quarantinedProducts).toBe(1);
        expect(repo.listQuarantined()).toHaveLength(1);
      });
    });
  });

  describe("GIVEN v1 followed by v2 delta snapshots are ingested", () => {
    it("THEN basis-point rate changes are recorded across the two snapshots", () => {
      withRepo((repo) => {
        ingestSnapshotDirectory(
          repo,
          silentLogger,
          join(process.cwd(), "sample-data/snapshots/v1"),
          "v1",
        );
        ingestSnapshotDirectory(
          repo,
          silentLogger,
          join(process.cwd(), "sample-data/snapshots/v2"),
          "v2",
        );

        const changes = repo.getRateChanges();
        expect(changes.some((c) => c.bankSlug === "up" && c.headlineDeltaBps === 15)).toBe(true);
      });
    });
  });
});
