import { Hono } from "hono";
import type { ProductRepository } from "../../db/repository.js";
import type { Clock } from "../../ports.js";

export function createHealthRoutes(repo: ProductRepository, clock: Clock): Hono {
  const routes = new Hono();

  routes.get("/", (c) => {
    const banks = repo.listBankStatuses();
    const degradedCount = banks.filter((b) => b.degraded).length;
    return c.json({
      status: degradedCount > 0 ? "degraded" : "ok",
      timestamp: clock.nowIso(),
      bankCount: banks.length,
      degradedCount,
      banks,
    });
  });

  return routes;
}
