import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProductRepository } from "../db/repository.js";
import { validateAndNormaliseBatch } from "../domain/normalise.js";
import type { Logger } from "../logger.js";
import { BankSnapshotSchema } from "./schema.js";

export interface IngestSummary {
  mode: "snapshot" | "live";
  version?: string;
  banksProcessed: number;
  banksDegraded: number;
  validProducts: number;
  quarantinedProducts: number;
}

export function ingestSnapshotDirectory(
  repo: ProductRepository,
  logger: Logger,
  snapshotDir: string,
  versionLabel: string,
): IngestSummary {
  const files = readdirSync(snapshotDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  let banksProcessed = 0;
  let validProducts = 0;
  let quarantinedProducts = 0;

  for (const file of files) {
    const filePath = join(snapshotDir, file);
    const raw = JSON.parse(readFileSync(filePath, "utf8"));
    const envelope = BankSnapshotSchema.parse(raw);
    const { valid, quarantined } = validateAndNormaliseBatch(
      envelope.bankSlug,
      envelope.bankName,
      envelope.products,
    );

    repo.recordSnapshot({
      bankSlug: envelope.bankSlug,
      bankName: envelope.bankName,
      sourceUrl: envelope.sourceUrl,
      cdrVersion: envelope.cdrVersion,
      source: "snapshot",
      capturedAt: envelope.capturedAt,
      products: valid,
      quarantined,
    });

    banksProcessed += 1;
    validProducts += valid.length;
    quarantinedProducts += quarantined.length;

    if (quarantined.length > 0) {
      logger.warn("Quarantined malformed CDR products during snapshot ingest", {
        bankSlug: envelope.bankSlug,
        quarantinedCount: quarantined.length,
        version: versionLabel,
      });
    }
  }

  logger.info("Completed snapshot ingest", {
    version: versionLabel,
    banksProcessed,
    validProducts,
    quarantinedProducts,
  });

  return {
    mode: "snapshot",
    version: versionLabel,
    banksProcessed,
    banksDegraded: 0,
    validProducts,
    quarantinedProducts,
  };
}
