import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import { syncLiveBanks } from "../cdr/live-client.js";
import { ingestSnapshotDirectory } from "../cdr/loader.js";
import type { AppConfig } from "../config.js";
import type { ProductRepository } from "../db/repository.js";
import type { Logger } from "../logger.js";

const productQuerySchema = z.object({
  bank: z.string().min(1).optional(),
  rateType: z.enum(["VARIABLE", "FIXED", "OTHER"]).optional(),
  hasOffset: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  hasRedraw: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  reviewStatus: z.enum(["READY", "MANUAL_REVIEW_REQUIRED"]).optional(),
  search: z.string().max(100).optional(),
});

const ingestRequestSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("snapshot"),
    version: z.enum(["v1", "v2"]).default("v1"),
  }),
  z.object({
    mode: z.literal("live"),
    bankSlug: z.string().min(1).optional(),
  }),
  z.object({
    mode: z.literal("simulate-degrade"),
    bankSlug: z.string().min(1),
    reason: z.string().min(1).max(200).default("Simulated HTTP 406 UnsupportedVersion"),
  }),
]);

export interface AppDependencies {
  config: AppConfig;
  repo: ProductRepository;
  logger: Logger;
  snapshotsRootDir?: string;
  publicDir?: string;
  fetchFn?: typeof fetch;
}

export function createApp(deps: AppDependencies) {
  const { config, repo, logger } = deps;
  const snapshotsRootDir = deps.snapshotsRootDir ?? join(process.cwd(), "sample-data/snapshots");
  const publicDir = deps.publicDir ?? join(process.cwd(), "public");
  const app = new Hono();

  // Request correlation ID + structured request logging
  app.use("*", async (c, next) => {
    const requestId = c.req.header("x-request-id") ?? randomUUID();
    const start = Date.now();
    c.header("x-request-id", requestId);
    await next();
    logger.info("http_request", {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - start,
    });
  });

  app.onError((err, c) => {
    const requestId = c.res.headers.get("x-request-id") ?? randomUUID();
    logger.error("unhandled_http_error", {
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

  app.get("/health", (c) => {
    const banks = repo.listBankStatuses();
    const degradedBanks = banks.filter((b) => b.degraded);
    return c.json({
      status: degradedBanks.length > 0 ? "degraded" : "ok",
      timestamp: new Date().toISOString(),
      bankCount: banks.length,
      degradedCount: degradedBanks.length,
      banks,
    });
  });

  app.get("/api/products", (c) => {
    const parsed = productQuerySchema.safeParse({
      bank: c.req.query("bank") || undefined,
      rateType: c.req.query("rateType") || undefined,
      hasOffset: c.req.query("hasOffset") || undefined,
      hasRedraw: c.req.query("hasRedraw") || undefined,
      reviewStatus: c.req.query("reviewStatus") || undefined,
      search: c.req.query("search") || undefined,
    });

    if (!parsed.success) {
      return c.json(
        {
          error: "INVALID_QUERY",
          details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        },
        400,
      );
    }

    const products = repo.listLatestProducts({
      bankSlug: parsed.data.bank,
      rateType: parsed.data.rateType,
      hasOffset: parsed.data.hasOffset,
      hasRedraw: parsed.data.hasRedraw,
      reviewStatus: parsed.data.reviewStatus,
      search: parsed.data.search,
    });

    const readyCount = products.filter((p) => p.reviewStatus === "READY").length;
    const manualReviewCount = products.length - readyCount;

    return c.json({
      disclaimer:
        "Indicative comparison from public AU CDR Product Reference Data only. Not financial or credit advice.",
      total: products.length,
      readyCount,
      manualReviewCount,
      products,
    });
  });

  app.get("/api/products/:bankSlug/:productId", (c) => {
    const { bankSlug, productId } = c.req.param();
    const product = repo.getProductDetail(bankSlug, productId);
    if (!product) {
      return c.json({ error: "NOT_FOUND", message: "Product not found" }, 404);
    }
    return c.json({ product });
  });

  app.get("/api/changes", (c) => {
    const changes = repo.getRateChanges();
    return c.json({ total: changes.length, changes });
  });

  app.get("/api/quarantine", (c) => {
    const records = repo.listQuarantined(50);
    return c.json({ total: records.length, records });
  });

  app.post("/api/ingest", async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "INVALID_JSON", message: "Request body must be valid JSON" }, 400);
    }

    const parsed = ingestRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        {
          error: "INVALID_REQUEST",
          details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        },
        400,
      );
    }

    const payload = parsed.data;
    if (payload.mode === "snapshot") {
      const dir = join(snapshotsRootDir, payload.version);
      const summary = ingestSnapshotDirectory(repo, logger, dir, payload.version);
      return c.json({ summary });
    }

    if (payload.mode === "simulate-degrade") {
      const existing = repo.listBankStatuses().find((b) => b.bankSlug === payload.bankSlug);
      if (!existing) {
        return c.json({ error: "NOT_FOUND", message: `Bank "${payload.bankSlug}" not found` }, 404);
      }
      repo.recordDegradedSync({
        bankSlug: existing.bankSlug,
        bankName: existing.bankName,
        sourceUrl: existing.sourceUrl,
        cdrVersion: existing.cdrVersion,
        source: "live",
        attemptedAt: new Date().toISOString(),
        errorMessage: payload.reason,
      });
      return c.json({
        status: "degraded",
        bankSlug: existing.bankSlug,
        message: "Simulated upstream failure recorded; last verified snapshot preserved.",
      });
    }

    if (!config.allowLiveSync) {
      return c.json(
        { error: "LIVE_SYNC_DISABLED", message: "Outbound live CDR sync is disabled by config." },
        403,
      );
    }

    try {
      const summary = await syncLiveBanks(repo, logger, {
        timeoutMs: config.cdrTimeoutMs,
        bankSlug: payload.bankSlug,
        fetchFn: deps.fetchFn,
      });
      return c.json({ summary });
    } catch (err) {
      return c.json(
        { error: "INVALID_BANK", message: err instanceof Error ? err.message : String(err) },
        400,
      );
    }
  });

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
