import { join } from "node:path";
import { ingestSnapshotDirectory } from "../cdr/loader.js";
import { loadConfig } from "../config.js";
import { createSqliteProductRepository } from "../db/sqlite-repository.js";
import { createLogger } from "../logger.js";

function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel, { service: "cdr-sync-cli" });
  const repo = createSqliteProductRepository(config.dbPath);

  try {
    const dir = join(process.cwd(), "sample-data/snapshots/v1");
    const summary = ingestSnapshotDirectory(repo, logger, dir);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    repo.close();
  }
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
