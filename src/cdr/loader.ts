import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProductRepository } from "../db/repository.js";
import { validateAndNormaliseBatch } from "../domain/normalise.js";
import type { Logger } from "../logger.js";
import { BankSnapshotSchema } from "./schema.js";

export interface IngestSummary {
  readonly mode: "snapshot";
  readonly version: string;
  readonly banksProcessed: number;
  readonly validProducts: number;
  readonly quarantinedProducts: number;
}

export function ingestSnapshotDirectory(
  repo: ProductRepository,
  logger: Logger,
  snapshotDir: string,
  versionLabel: string,
): IngestSummary {
  const files = readdirSync(snapshotDir)
    .filter((f) => f.endsWith(".json"))
    .toSorted();

  const totals = files.reduce(
    (acc, file) => {
      const raw = JSON.parse(readFileSync(join(snapshotDir, file), "utf8"));
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

      if (quarantined.length > 0) {
        logger.warn("Quarantined malformed CDR products during snapshot ingest", {
          bankSlug: envelope.bankSlug,
          quarantinedCount: quarantined.length,
          version: versionLabel,
        });
      }

      return {
        banksProcessed: acc.banksProcessed + 1,
        validProducts: acc.validProducts + valid.length,
        quarantinedProducts: acc.quarantinedProducts + quarantined.length,
      };
    },
    { banksProcessed: 0, validProducts: 0, quarantinedProducts: 0 },
  );

  logger.info("Completed snapshot ingest", {
    version: versionLabel,
    ...totals,
  });

  return {
    mode: "snapshot",
    version: versionLabel,
    ...totals,
  };
}
