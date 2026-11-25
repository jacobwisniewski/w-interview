import { describe, expect, it } from "vitest";
import { syncLiveBanks } from "../live-client.js";
import { createSqliteProductRepository } from "../../db/sqlite-repository.js";
import { createLogger } from "../../logger.js";

const silentLogger = createLogger("error", {}, () => {});

async function withRepo<T>(
  run: (repo: ReturnType<typeof createSqliteProductRepository>) => Promise<T>,
): Promise<T> {
  const repo = createSqliteProductRepository(":memory:");
  try {
    return await run(repo);
  } finally {
    repo.close();
  }
}

describe("Allowlisted Live CDR Client & Version Negotiation", () => {
  describe("GIVEN an upstream bank rejects x-v=6 with HTTP 406 and accepts x-v=7", () => {
    it("THEN the client negotiates to x-v=7 and persists the normalised mortgage product", async () => {
      await withRepo(async (repo) => {
        const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
          const url = String(input);
          const xv = new Headers(init?.headers).get("x-v") ?? "";

          if (url.includes("product-category=RESIDENTIAL_MORTGAGES")) {
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

        expect(summary.banksProcessed).toBe(1);
        expect(summary.banksDegraded).toBe(0);
        expect(repo.listLatestProducts({ bankSlug: "up" })).toHaveLength(1);
      });
    });
  });

  describe("GIVEN an upstream CDR endpoint times out", () => {
    it("THEN the bank is marked degraded with the error reason recorded", async () => {
      await withRepo(async (repo) => {
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
    });
  });

  describe("GIVEN a caller requests a bank slug not present in the static allowlist", () => {
    it("THEN the client rejects the request to prevent SSRF", async () => {
      await withRepo(async (repo) => {
        await expect(
          syncLiveBanks(repo, silentLogger, {
            timeoutMs: 500,
            bankSlug: "evil-unlisted-bank",
          }),
        ).rejects.toThrow(/allowlisted CDR manifest/);
      });
    });
  });
});
