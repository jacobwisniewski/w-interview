import { join } from "node:path";
import { syncLiveBanks } from "../cdr/live-client.js";
import { ingestSnapshotDirectory } from "../cdr/loader.js";
import { loadConfig } from "../config.js";
import { createSqliteProductRepository } from "../db/sqlite-repository.js";
import { createLogger } from "../logger.js";

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel, { service: "cdr-sync-cli" });
  const repo = createSqliteProductRepository(config.dbPath);

  const isLive = process.argv.includes("--live");
  const versionArg = process.argv.find((a) => a.startsWith("--version="))?.split("=")[1] ?? "v1";
  const bankArg = process.argv.find((a) => a.startsWith("--bank="))?.split("=")[1];

  try {
    if (isLive) {
      if (!config.allowLiveSync) {
        throw new Error("ALLOW_LIVE_SYNC=false prevents outbound CDR requests");
      }
      const summary = await syncLiveBanks(repo, logger, {
        timeoutMs: config.cdrTimeoutMs,
        bankSlug: bankArg,
      });
      console.log(JSON.stringify(summary, null, 2));
    } else {
      const dir = join(process.cwd(), "sample-data/snapshots", versionArg);
      const summary = ingestSnapshotDirectory(repo, logger, dir, versionArg);
      console.log(JSON.stringify(summary, null, 2));
    }
  } finally {
    repo.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
