import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const syncRuns = sqliteTable("sync_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  bankSlug: text("bank_slug").notNull(),
  bankName: text("bank_name").notNull(),
  source: text("source").notNull(),
  outcome: text("outcome").notNull(),
  cdrVersion: text("cdr_version").notNull(),
  capturedAt: text("captured_at").notNull(),
  validCount: integer("valid_count").notNull().default(0),
  quarantinedCount: integer("quarantined_count").notNull().default(0),
  errorMessage: text("error_message"),
});

export const bankStatus = sqliteTable("bank_status", {
  bankSlug: text("bank_slug").primaryKey(),
  bankName: text("bank_name").notNull(),
  sourceUrl: text("source_url").notNull(),
  cdrVersion: text("cdr_version").notNull(),
  lastSyncedAt: text("last_synced_at").notNull(),
  lastGoodSyncRunId: integer("last_good_sync_run_id").references(() => syncRuns.id),
  degraded: integer("degraded", { mode: "boolean" }).notNull().default(false),
  lastError: text("last_error"),
  validProductCount: integer("valid_product_count").notNull().default(0),
  quarantinedCount: integer("quarantined_count").notNull().default(0),
});

export const products = sqliteTable(
  "products",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    syncRunId: integer("sync_run_id")
      .notNull()
      .references(() => syncRuns.id, { onDelete: "cascade" }),
    bankSlug: text("bank_slug").notNull(),
    bankName: text("bank_name").notNull(),
    productId: text("product_id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    lastUpdated: text("last_updated"),
    overviewUri: text("overview_uri"),
    rateType: text("rate_type").notNull(),
    headlineRatePct: real("headline_rate_pct"),
    comparisonRatePct: real("comparison_rate_pct"),
    annualFeeCents: integer("annual_fee_cents").notNull().default(0),
    upfrontFeeCents: integer("upfront_fee_cents").notNull().default(0),
    hasOffset: integer("has_offset", { mode: "boolean" }).notNull().default(false),
    hasRedraw: integer("has_redraw", { mode: "boolean" }).notNull().default(false),
    reviewStatus: text("review_status").notNull(),
    reviewReasonsJson: text("review_reasons_json").notNull(),
    rawRateCount: integer("raw_rate_count").notNull().default(0),
  },
  (table) => [
    uniqueIndex("uq_products_run_bank_product").on(
      table.syncRunId,
      table.bankSlug,
      table.productId,
    ),
    index("idx_products_sync_run").on(table.syncRunId),
    index("idx_products_bank_product").on(table.bankSlug, table.productId),
  ],
);

export const quarantinedProducts = sqliteTable("quarantined_products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  syncRunId: integer("sync_run_id")
    .notNull()
    .references(() => syncRuns.id, { onDelete: "cascade" }),
  bankSlug: text("bank_slug").notNull(),
  productId: text("product_id"),
  reason: text("reason").notNull(),
  rawPayload: text("raw_payload").notNull(),
  recordedAt: text("recorded_at").notNull(),
});
