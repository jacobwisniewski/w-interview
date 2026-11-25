import { join } from "node:path";
import { serve } from "@hono/node-server";
import { ingestSnapshotDirectory } from "./cdr/loader.js";
import { loadConfig } from "./config.js";
import { SqliteProductRepository } from "./db/sqlite-repository.js";
import { createLogger } from "./logger.js";
import { createApp } from "./server/app.js";

const config = loadConfig();
const logger = createLogger(config.logLevel, { service: "cdr-home-loan-monitor" });
const repo = new SqliteProductRepository(config.dbPath);

// Seed local v1 snapshot automatically on first boot so a clean checkout works immediately
if (repo.listBankStatuses().length === 0) {
  const v1Dir = join(process.cwd(), "sample-data/snapshots/v1");
  ingestSnapshotDirectory(repo, logger, v1Dir, "v1");
}

const app = createApp({ config, repo, logger });

serve({ fetch: app.fetch, port: config.port }, (info) => {
  logger.info("Server listening", { url: `http://localhost:${info.port}`, dbPath: config.dbPath });
});
