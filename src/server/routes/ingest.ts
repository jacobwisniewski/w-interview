import { join } from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import { syncLiveBanks } from "../../cdr/live-client.js";
import { ingestSnapshotDirectory } from "../../cdr/loader.js";
import type { AppConfig } from "../../config.js";
import type { ProductRepository } from "../../db/repository.js";
import type { Logger } from "../../logger.js";
import type { Clock, HttpFetcher } from "../../ports.js";

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

export interface IngestRouteDependencies {
  readonly config: AppConfig;
  readonly repo: ProductRepository;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly snapshotsRootDir: string;
  readonly fetchFn?: HttpFetcher;
}

async function safeReadJson(
  read: () => Promise<unknown>,
): Promise<{ readonly ok: true; readonly data: unknown } | { readonly ok: false }> {
  try {
    return { ok: true, data: await read() };
  } catch {
    return { ok: false };
  }
}

export function createIngestRoutes(deps: IngestRouteDependencies): Hono {
  const routes = new Hono();

  routes.post("/ingest", async (c) => {
    const jsonBody = await safeReadJson(() => c.req.json());
    if (!jsonBody.ok) {
      return c.json({ error: "INVALID_JSON", message: "Request body must be valid JSON" }, 400);
    }

    const parsed = ingestRequestSchema.safeParse(jsonBody.data);
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
      const dir = join(deps.snapshotsRootDir, payload.version);
      const summary = ingestSnapshotDirectory(deps.repo, deps.logger, dir, payload.version);
      return c.json({ summary });
    }

    if (payload.mode === "simulate-degrade") {
      const existing = deps.repo.listBankStatuses().find((b) => b.bankSlug === payload.bankSlug);
      if (!existing) {
        return c.json({ error: "NOT_FOUND", message: `Bank "${payload.bankSlug}" not found` }, 404);
      }
      deps.repo.recordDegradedSync({
        bankSlug: existing.bankSlug,
        bankName: existing.bankName,
        sourceUrl: existing.sourceUrl,
        cdrVersion: existing.cdrVersion,
        source: "live",
        attemptedAt: deps.clock.nowIso(),
        errorMessage: payload.reason,
      });
      return c.json({
        status: "degraded",
        bankSlug: existing.bankSlug,
        message: "Simulated upstream failure recorded; last verified snapshot preserved.",
      });
    }

    if (!deps.config.allowLiveSync) {
      return c.json(
        { error: "LIVE_SYNC_DISABLED", message: "Outbound live CDR sync is disabled by config." },
        403,
      );
    }

    try {
      const summary = await syncLiveBanks(deps.repo, deps.logger, {
        timeoutMs: deps.config.cdrTimeoutMs,
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

  return routes;
}
