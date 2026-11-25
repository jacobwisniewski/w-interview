import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { SqliteProductRepository } from "../src/db/sqlite-repository.js";
import { createLogger } from "../src/logger.js";
import { createApp } from "../src/server/app.js";

describe("HTTP API integration", () => {
  let repo: SqliteProductRepository | null = null;

  afterEach(() => {
    repo?.close();
    repo = null;
  });

  function setupApp(envOverrides: Record<string, string> = {}) {
    repo = new SqliteProductRepository(":memory:");
    const config = loadConfig({ DB_PATH: ":memory:", LOG_LEVEL: "error", ...envOverrides });
    const logger = createLogger("error", {}, () => {});
    return createApp({ config, repo, logger });
  }

  it("ingests v1 and v2 snapshots, serves filtered products (including Westpac), quarantine, and rate diffs", async () => {
    const app = setupApp();

    // Ingest baseline v1 (41 real AU banks + example-bank)
    const ingestV1 = await app.request("/api/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "snapshot", version: "v1" }),
    });
    expect(ingestV1.status).toBe(200);
    const v1Body = (await ingestV1.json()) as {
      summary: { banksProcessed: number; validProducts: number; quarantinedProducts: number };
    };
    expect(v1Body.summary.banksProcessed).toBeGreaterThanOrEqual(42);
    expect(v1Body.summary.validProducts).toBeGreaterThanOrEqual(105);
    expect(v1Body.summary.quarantinedProducts).toBe(1);

    // Check Westpac public CDR products are queryable
    const westpacRes = await app.request("/api/products?bank=westpac");
    expect(westpacRes.status).toBe(200);
    const westpacJson = (await westpacRes.json()) as {
      total: number;
      products: Array<{ bankSlug: string; productId: string }>;
    };
    expect(westpacJson.total).toBeGreaterThanOrEqual(1);
    expect(westpacJson.products[0]?.bankSlug).toBe("westpac");

    // Product detail 200 and 404
    const firstId = westpacJson.products[0]!.productId;
    const detailOk = await app.request(`/api/products/westpac/${encodeURIComponent(firstId)}`);
    expect(detailOk.status).toBe(200);
    const detailMissing = await app.request("/api/products/westpac/does-not-exist");
    expect(detailMissing.status).toBe(404);

    // Quarantine endpoint exposes malformed record
    const qRes = await app.request("/api/quarantine");
    expect(qRes.status).toBe(200);
    const qJson = (await qRes.json()) as { total: number };
    expect(qJson.total).toBe(1);

    // Ingest v2 delta snapshot and verify basis-point rate changes
    const ingestV2 = await app.request("/api/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "snapshot", version: "v2" }),
    });
    expect(ingestV2.status).toBe(200);

    const changesRes = await app.request("/api/changes");
    expect(changesRes.status).toBe(200);
    const changesJson = (await changesRes.json()) as {
      total: number;
      changes: Array<{ bankSlug: string; headlineDeltaBps: number }>;
    };
    expect(changesJson.total).toBeGreaterThanOrEqual(1);
    expect(changesJson.changes.some((c) => c.bankSlug === "up" && c.headlineDeltaBps === 15)).toBe(
      true,
    );
  });

  it("rejects invalid query parameters and handles degraded-mode simulation safely", async () => {
    const app = setupApp({ ALLOW_LIVE_SYNC: "false" });

    await app.request("/api/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "snapshot", version: "v1" }),
    });

    // Invalid query enum -> 400
    const badQuery = await app.request("/api/products?rateType=BOGUS");
    expect(badQuery.status).toBe(400);

    // Disabled live sync -> 403
    const liveBlocked = await app.request("/api/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "live", bankSlug: "up" }),
    });
    expect(liveBlocked.status).toBe(403);

    // Simulate upstream failure -> /health reports degraded, data stays available
    const degradeRes = await app.request("/api/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "simulate-degrade",
        bankSlug: "up",
        reason: "Simulated HTTP 406 UnsupportedVersion",
      }),
    });
    expect(degradeRes.status).toBe(200);

    const healthRes = await app.request("/health");
    const healthJson = (await healthRes.json()) as { status: string; degradedCount: number };
    expect(healthJson.status).toBe("degraded");
    expect(healthJson.degradedCount).toBe(1);

    const upProducts = await app.request("/api/products?bank=up");
    const upJson = (await upProducts.json()) as { total: number };
    expect(upJson.total).toBe(1);
  });
});
