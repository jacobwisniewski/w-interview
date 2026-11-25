import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import type { AppConfig } from "../config.js";
import type { ProductRepository } from "../db/repository.js";
import type { Logger } from "../logger.js";
import { systemClock, type Clock } from "../ports.js";
import { createRequestLoggerMiddleware } from "./middleware/request-logger.js";
import { createHealthRoutes } from "./routes/health.js";
import { createIngestRoutes } from "./routes/ingest.js";
import { createProductRoutes } from "./routes/products.js";

export interface AppDependencies {
  readonly config: AppConfig;
  readonly repo: ProductRepository;
  readonly logger: Logger;
  readonly clock?: Clock;
  readonly snapshotsRootDir?: string;
  readonly publicDir?: string;
}

export function createApp(deps: AppDependencies): Hono {
  const clock = deps.clock ?? systemClock;
  const snapshotsRootDir = deps.snapshotsRootDir ?? join(process.cwd(), "sample-data/snapshots");
  const publicDir = deps.publicDir ?? join(process.cwd(), "public");
  const app = new Hono();

  app.use("*", createRequestLoggerMiddleware(deps.logger, clock));

  app.onError((err, c) => {
    const requestId = c.res.headers.get("x-request-id") ?? randomUUID();
    deps.logger.error("unhandled_http_error", {
      requestId,
      path: c.req.path,
      error: err.message,
    });
    return c.json(
      {
        error: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred.",
        requestId,
      },
      500,
    );
  });

  app.route("/health", createHealthRoutes(deps.repo, clock));
  app.route("/api", createProductRoutes(deps.repo));
  app.route(
    "/api",
    createIngestRoutes({
      repo: deps.repo,
      logger: deps.logger,
      clock,
      snapshotsRootDir,
    }),
  );

  app.get("/", (c) => {
    const indexPath = join(publicDir, "index.html");
    if (existsSync(indexPath)) {
      return c.html(readFileSync(indexPath, "utf8"));
    }
    return c.json({
      service: "cdr-home-loan-monitor",
      endpoints: ["/health", "/api/products", "/api/changes", "/api/quarantine", "/api/ingest"],
    });
  });

  return app;
}
