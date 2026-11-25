import { Hono } from "hono";
import { z } from "zod";
import type { ProductRepository } from "../../db/repository.js";

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

const DISCLAIMER =
  "Indicative comparison from public AU CDR Product Reference Data only. Not financial or credit advice.";

export function createProductRoutes(repo: ProductRepository): Hono {
  const routes = new Hono();

  routes.get("/products", (c) => {
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

    return c.json({
      disclaimer: DISCLAIMER,
      total: products.length,
      readyCount,
      manualReviewCount: products.length - readyCount,
      products,
    });
  });

  routes.get("/products/:bankSlug/:productId", (c) => {
    const { bankSlug, productId } = c.req.param();
    const product = repo.getProductDetail(bankSlug, productId);
    if (!product) {
      return c.json({ error: "NOT_FOUND", message: "Product not found" }, 404);
    }
    return c.json({ product });
  });

  routes.get("/changes", (c) => {
    const changes = repo.getRateChanges();
    return c.json({ total: changes.length, changes });
  });

  routes.get("/quarantine", (c) => {
    const records = repo.listQuarantined(50);
    return c.json({ total: records.length, records });
  });

  return routes;
}
