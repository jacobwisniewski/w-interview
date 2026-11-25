import { describe, expect, it } from "vitest";
import { loadConfig } from "../../config.js";
import { createSqliteProductRepository } from "../../db/sqlite-repository.js";
import { createLogger } from "../../logger.js";
import { createApp } from "../app.js";

async function withApiApp<T>(run: (app: ReturnType<typeof createApp>) => Promise<T>): Promise<T> {
  const repo = createSqliteProductRepository(":memory:");
  const config = loadConfig({ DB_PATH: ":memory:", LOG_LEVEL: "error" });
  const logger = createLogger("error", {}, () => {});
  const app = createApp({ config, repo, logger });
  try {
    return await run(app);
  } finally {
    repo.close();
  }
}

describe("CDR Home Loan Monitor HTTP API", () => {
  describe("GIVEN the bundled snapshot is ingested through the API", () => {
    it("THEN analysts can query Westpac products, inspect quarantine records, and fetch rate changes", async () => {
      await withApiApp(async (app) => {
        const ingestRes = await app.request("/api/ingest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "snapshot" }),
        });
        expect(ingestRes.status).toBe(200);
        const ingestBody = (await ingestRes.json()) as {
          readonly summary: {
            readonly banksProcessed: number;
            readonly validProducts: number;
            readonly quarantinedProducts: number;
          };
        };
        expect(ingestBody.summary.banksProcessed).toBeGreaterThanOrEqual(42);
        expect(ingestBody.summary.validProducts).toBeGreaterThanOrEqual(105);
        expect(ingestBody.summary.quarantinedProducts).toBe(1);

        const westpacRes = await app.request("/api/products?bank=westpac");
        expect(westpacRes.status).toBe(200);
        const westpacJson = (await westpacRes.json()) as {
          readonly total: number;
          readonly products: readonly {
            readonly bankSlug: string;
            readonly productId: string;
          }[];
        };
        expect(westpacJson.total).toBeGreaterThanOrEqual(1);

        const firstId = westpacJson.products[0]!.productId;
        expect(
          (await app.request(`/api/products/westpac/${encodeURIComponent(firstId)}`)).status,
        ).toBe(200);
        expect((await app.request("/api/products/westpac/does-not-exist")).status).toBe(404);

        const qJson = (await (await app.request("/api/quarantine")).json()) as {
          readonly total: number;
        };
        expect(qJson.total).toBe(1);

        const changesRes = await app.request("/api/changes");
        expect(changesRes.status).toBe(200);
        const changesJson = (await changesRes.json()) as {
          readonly changes: readonly unknown[];
        };
        expect(Array.isArray(changesJson.changes)).toBe(true);
      });
    });
  });

  describe("GIVEN invalid queries or an upstream degrade simulation", () => {
    it("THEN the API rejects bad input with 400 and surfaces degraded health without losing data", async () => {
      await withApiApp(async (app) => {
        await app.request("/api/ingest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "snapshot" }),
        });

        expect((await app.request("/api/products?rateType=BOGUS")).status).toBe(400);

        await app.request("/api/ingest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "simulate-degrade",
            bankSlug: "up",
            reason: "Simulated HTTP 406 UnsupportedVersion",
          }),
        });

        const health = (await (await app.request("/health")).json()) as {
          readonly status: string;
          readonly degradedCount: number;
        };
        expect(health.status).toBe("degraded");
        expect(health.degradedCount).toBe(1);

        const upJson = (await (await app.request("/api/products?bank=up")).json()) as {
          readonly total: number;
        };
        expect(upJson.total).toBe(1);
      });
    });
  });
});
