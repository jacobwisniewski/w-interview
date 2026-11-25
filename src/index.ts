import { join } from "node:path";
import { serve } from "@hono/node-server";
import { ingestSnapshotDirectory } from "./cdr/loader.js";
import { loadConfig } from "./config.js";
import { createSqliteProductRepository } from "./db/sqlite-repository.js";
import { createLogger } from "./logger.js";
import { createApp } from "./server/app.js";

const config = loadConfig();
const logger = createLogger(config.logLevel, { service: "cdr-home-loan-monitor" });
const repo = createSqliteProductRepository(config.dbPath);

if (repo.listBankStatuses().length === 0) {
  const snapshotsDir = join(process.cwd(), "sample-data/snapshots/v1");
  ingestSnapshotDirectory(repo, logger, snapshotsDir);
}

const app = createApp({ config, repo, logger });

serve({ fetch: app.fetch, port: config.port }, (info) => {
  logger.info("Server listening", { url: `http://localhost:${info.port}`, dbPath: config.dbPath });
});
