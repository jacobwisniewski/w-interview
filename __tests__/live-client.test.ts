import { afterEach, describe, expect, it } from "vitest";
import { syncLiveBanks } from "../src/cdr/live-client.js";
import { SqliteProductRepository } from "../src/db/sqlite-repository.js";
import { createLogger } from "../src/logger.js";

describe("syncLiveBanks", () => {
  let repo: SqliteProductRepository | null = null;
  const silentLogger = createLogger("error", {}, () => {});

  afterEach(() => {
    repo?.close();
    repo = null;
  });

  it("negotiates x-v header downward on HTTP 406 and persists valid product", async () => {
    repo = new SqliteProductRepository(":memory:");
    const seenVersions: string[] = [];

    const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      const xv = headers.get("x-v") ?? "";
      seenVersions.push(xv);

      if (url.includes("product-category=RESIDENTIAL_MORTGAGES")) {
        // Reject x-v=6 with 406, accept x-v=7
        if (xv === "6") {
          return new Response(JSON.stringify({ errors: [{ code: 406 }] }), { status: 406 });
        }
        return new Response(
          JSON.stringify({
            data: {
              products: [{ productId: "up-home", productCategory: "RESIDENTIAL_MORTGAGES" }],
            },
          }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          data: {
            productId: "up-home",
            productCategory: "RESIDENTIAL_MORTGAGES",
            name: "Up Home Loan",
            lendingRates: [
              { lendingRateType: "VARIABLE", rate: "0.0595", comparisonRate: "0.0595" },
            ],
            features: [{ featureType: "OFFSET" }],
            fees: [],
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const summary = await syncLiveBanks(repo, silentLogger, {
      timeoutMs: 2000,
      bankSlug: "up",
      fetchFn: mockFetch,
    });

    expect(seenVersions).toContain("6");
    expect(seenVersions).toContain("7");
    expect(summary.banksProcessed).toBe(1);
    expect(summary.banksDegraded).toBe(0);
    expect(repo.listLatestProducts({ bankSlug: "up" })).toHaveLength(1);
  });

  it("records degraded status cleanly on upstream timeout/network failure", async () => {
    repo = new SqliteProductRepository(":memory:");
    const failingFetch = (async () => {
      throw new Error("ConnectTimeoutError");
    }) as typeof fetch;

    const summary = await syncLiveBanks(repo, silentLogger, {
      timeoutMs: 500,
      bankSlug: "up",
      fetchFn: failingFetch,
    });

    expect(summary.banksProcessed).toBe(0);
    expect(summary.banksDegraded).toBe(1);
    const status = repo.listBankStatuses().find((b) => b.bankSlug === "up");
    expect(status?.degraded).toBe(true);
    expect(status?.lastError).toContain("ConnectTimeoutError");
  });

  it("rejects non-allowlisted bank slugs to prevent SSRF", async () => {
    repo = new SqliteProductRepository(":memory:");
    await expect(
      syncLiveBanks(repo, silentLogger, {
        timeoutMs: 500,
        bankSlug: "evil-unlisted-bank",
      }),
    ).rejects.toThrow(/allowlisted CDR manifest/);
  });
});
