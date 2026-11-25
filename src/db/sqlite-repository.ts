import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  computeRateDiffs,
  type NormalisedProduct,
  type PrimaryRateType,
  type QuarantinedRecord,
  type RateChange,
  type ReviewStatus,
} from "../domain/normalise.js";
import type {
  BankStatus,
  ProductQueryFilters,
  ProductRepository,
  RecordDegradedInput,
  RecordSnapshotInput,
} from "./repository.js";

interface ProductRow {
  readonly bank_slug: string;
  readonly bank_name: string;
  readonly product_id: string;
  readonly name: string;
  readonly description: string;
  readonly last_updated: string | null;
  readonly overview_uri: string | null;
  readonly rate_type: string;
  readonly headline_rate_pct: number | null;
  readonly comparison_rate_pct: number | null;
  readonly annual_fee_cents: number;
  readonly upfront_fee_cents: number;
  readonly has_offset: number;
  readonly has_redraw: number;
  readonly review_status: string;
  readonly review_reasons_json: string;
  readonly raw_rate_count: number;
}

interface BankStatusRow {
  readonly bank_slug: string;
  readonly bank_name: string;
  readonly source_url: string;
  readonly cdr_version: string;
  readonly last_synced_at: string;
  readonly last_good_sync_run_id: number | null;
  readonly degraded: number;
  readonly last_error: string | null;
  readonly valid_product_count: number;
  readonly quarantined_count: number;
}

interface QuarantinedRow {
  readonly id: number;
  readonly bank_slug: string;
  readonly product_id: string | null;
  readonly reason: string;
  readonly raw_payload: string;
  readonly recorded_at: string;
}

function mapProductRow(row: ProductRow): NormalisedProduct {
  return {
    bankSlug: row.bank_slug,
    bankName: row.bank_name,
    productId: row.product_id,
    name: row.name,
    description: row.description,
    lastUpdated: row.last_updated,
    overviewUri: row.overview_uri,
    rateType: row.rate_type as PrimaryRateType,
    headlineRatePct: row.headline_rate_pct,
    comparisonRatePct: row.comparison_rate_pct,
    annualFeeCents: row.annual_fee_cents,
    upfrontFeeCents: row.upfront_fee_cents,
    hasOffset: row.has_offset === 1,
    hasRedraw: row.has_redraw === 1,
    reviewStatus: row.review_status as ReviewStatus,
    reviewReasons: JSON.parse(row.review_reasons_json) as readonly string[],
    rawRateCount: row.raw_rate_count,
  };
}

export class SqliteProductRepository implements ProductRepository {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bank_slug TEXT NOT NULL,
        bank_name TEXT NOT NULL,
        source TEXT NOT NULL,
        outcome TEXT NOT NULL,
        cdr_version TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        valid_count INTEGER NOT NULL DEFAULT 0,
        quarantined_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT
      );

      CREATE TABLE IF NOT EXISTS bank_status (
        bank_slug TEXT PRIMARY KEY,
        bank_name TEXT NOT NULL,
        source_url TEXT NOT NULL,
        cdr_version TEXT NOT NULL,
        last_synced_at TEXT NOT NULL,
        last_good_sync_run_id INTEGER REFERENCES sync_runs(id),
        degraded INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        valid_product_count INTEGER NOT NULL DEFAULT 0,
        quarantined_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sync_run_id INTEGER NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
        bank_slug TEXT NOT NULL,
        bank_name TEXT NOT NULL,
        product_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        last_updated TEXT,
        overview_uri TEXT,
        rate_type TEXT NOT NULL,
        headline_rate_pct REAL,
        comparison_rate_pct REAL,
        annual_fee_cents INTEGER NOT NULL DEFAULT 0,
        upfront_fee_cents INTEGER NOT NULL DEFAULT 0,
        has_offset INTEGER NOT NULL DEFAULT 0,
        has_redraw INTEGER NOT NULL DEFAULT 0,
        review_status TEXT NOT NULL,
        review_reasons_json TEXT NOT NULL,
        raw_rate_count INTEGER NOT NULL DEFAULT 0,
        UNIQUE(sync_run_id, bank_slug, product_id)
      );

      CREATE INDEX IF NOT EXISTS idx_products_sync_run ON products(sync_run_id);
      CREATE INDEX IF NOT EXISTS idx_products_bank_product ON products(bank_slug, product_id);

      CREATE TABLE IF NOT EXISTS quarantined_products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sync_run_id INTEGER NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
        bank_slug TEXT NOT NULL,
        product_id TEXT,
        reason TEXT NOT NULL,
        raw_payload TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      );
    `);
  }

  private runInTransaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  recordSnapshot(input: RecordSnapshotInput): { readonly syncRunId: number } {
    return this.runInTransaction(() => {
      const insertRun = this.db.prepare(`
        INSERT INTO sync_runs (bank_slug, bank_name, source, outcome, cdr_version, captured_at, valid_count, quarantined_count)
        VALUES (?, ?, ?, 'OK', ?, ?, ?, ?)
      `);
      const runResult = insertRun.run(
        input.bankSlug,
        input.bankName,
        input.source,
        input.cdrVersion,
        input.capturedAt,
        input.products.length,
        input.quarantined.length,
      );
      const syncRunId = Number(runResult.lastInsertRowid);

      const insertProduct = this.db.prepare(`
        INSERT INTO products (
          sync_run_id, bank_slug, bank_name, product_id, name, description,
          last_updated, overview_uri, rate_type, headline_rate_pct, comparison_rate_pct,
          annual_fee_cents, upfront_fee_cents, has_offset, has_redraw,
          review_status, review_reasons_json, raw_rate_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const p of input.products) {
        insertProduct.run(
          syncRunId,
          p.bankSlug,
          p.bankName,
          p.productId,
          p.name,
          p.description,
          p.lastUpdated,
          p.overviewUri,
          p.rateType,
          p.headlineRatePct,
          p.comparisonRatePct,
          p.annualFeeCents,
          p.upfrontFeeCents,
          p.hasOffset ? 1 : 0,
          p.hasRedraw ? 1 : 0,
          p.reviewStatus,
          JSON.stringify(p.reviewReasons),
          p.rawRateCount,
        );
      }

      const insertQuarantine = this.db.prepare(`
        INSERT INTO quarantined_products (sync_run_id, bank_slug, product_id, reason, raw_payload, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const q of input.quarantined) {
        insertQuarantine.run(
          syncRunId,
          q.bankSlug,
          q.productId,
          q.reason,
          q.rawPayload,
          input.capturedAt,
        );
      }

      const upsertStatus = this.db.prepare(`
        INSERT INTO bank_status (
          bank_slug, bank_name, source_url, cdr_version, last_synced_at,
          last_good_sync_run_id, degraded, last_error, valid_product_count, quarantined_count
        ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
        ON CONFLICT(bank_slug) DO UPDATE SET
          bank_name = excluded.bank_name,
          source_url = excluded.source_url,
          cdr_version = excluded.cdr_version,
          last_synced_at = excluded.last_synced_at,
          last_good_sync_run_id = excluded.last_good_sync_run_id,
          degraded = 0,
          last_error = NULL,
          valid_product_count = excluded.valid_product_count,
          quarantined_count = excluded.quarantined_count
      `);
      upsertStatus.run(
        input.bankSlug,
        input.bankName,
        input.sourceUrl,
        input.cdrVersion,
        input.capturedAt,
        syncRunId,
        input.products.length,
        input.quarantined.length,
      );

      return { syncRunId };
    });
  }

  recordDegradedSync(input: RecordDegradedInput): { readonly syncRunId: number } {
    return this.runInTransaction(() => {
      const insertRun = this.db.prepare(`
        INSERT INTO sync_runs (bank_slug, bank_name, source, outcome, cdr_version, captured_at, valid_count, quarantined_count, error_message)
        VALUES (?, ?, ?, 'DEGRADED', ?, ?, 0, 0, ?)
      `);
      const runResult = insertRun.run(
        input.bankSlug,
        input.bankName,
        input.source,
        input.cdrVersion,
        input.attemptedAt,
        input.errorMessage,
      );
      const syncRunId = Number(runResult.lastInsertRowid);

      const upsertStatus = this.db.prepare(`
        INSERT INTO bank_status (
          bank_slug, bank_name, source_url, cdr_version, last_synced_at,
          last_good_sync_run_id, degraded, last_error, valid_product_count, quarantined_count
        ) VALUES (?, ?, ?, ?, ?, NULL, 1, ?, 0, 0)
        ON CONFLICT(bank_slug) DO UPDATE SET
          degraded = 1,
          last_error = excluded.last_error
      `);
      upsertStatus.run(
        input.bankSlug,
        input.bankName,
        input.sourceUrl,
        input.cdrVersion,
        input.attemptedAt,
        input.errorMessage,
      );

      return { syncRunId };
    });
  }

  listLatestProducts(filters: ProductQueryFilters = {}): readonly NormalisedProduct[] {
    const filterEntries: readonly {
      readonly clause: string;
      readonly params: readonly (string | number)[];
    }[] = [
      { clause: "p.sync_run_id = bs.last_good_sync_run_id", params: [] },
      ...(filters.bankSlug ? [{ clause: "p.bank_slug = ?", params: [filters.bankSlug] }] : []),
      ...(filters.rateType ? [{ clause: "p.rate_type = ?", params: [filters.rateType] }] : []),
      ...(filters.hasOffset !== undefined
        ? [{ clause: "p.has_offset = ?", params: [filters.hasOffset ? 1 : 0] }]
        : []),
      ...(filters.hasRedraw !== undefined
        ? [{ clause: "p.has_redraw = ?", params: [filters.hasRedraw ? 1 : 0] }]
        : []),
      ...(filters.reviewStatus
        ? [{ clause: "p.review_status = ?", params: [filters.reviewStatus] }]
        : []),
      ...(filters.search
        ? [
            {
              clause: "(LOWER(p.name) LIKE ? OR LOWER(p.bank_name) LIKE ?)",
              params: [`%${filters.search.toLowerCase()}%`, `%${filters.search.toLowerCase()}%`],
            },
          ]
        : []),
    ];

    const whereSql = filterEntries.map((entry) => entry.clause).join(" AND ");
    const params = filterEntries.flatMap((entry) => entry.params);

    const sql = `
      SELECT p.*
      FROM products p
      INNER JOIN bank_status bs ON bs.bank_slug = p.bank_slug
      WHERE ${whereSql}
      ORDER BY
        CASE WHEN p.review_status = 'READY' THEN 0 ELSE 1 END ASC,
        CASE WHEN p.comparison_rate_pct IS NULL THEN 999 ELSE p.comparison_rate_pct END ASC,
        p.bank_name ASC,
        p.name ASC
    `;

    const rows = this.db.prepare(sql).all(...params) as unknown as readonly ProductRow[];
    return rows.map(mapProductRow);
  }

  getProductDetail(bankSlug: string, productId: string): NormalisedProduct | null {
    const row = this.db
      .prepare(
        `
        SELECT p.*
        FROM products p
        INNER JOIN bank_status bs ON bs.bank_slug = p.bank_slug
        WHERE p.sync_run_id = bs.last_good_sync_run_id
          AND p.bank_slug = ?
          AND p.product_id = ?
        LIMIT 1
      `,
      )
      .get(bankSlug, productId) as unknown as ProductRow | undefined;

    return row ? mapProductRow(row) : null;
  }

  listQuarantined(
    limit = 50,
  ): readonly Array<
    QuarantinedRecord & { readonly id: number; readonly recordedAt: string }
  >[number][] {
    const rows = this.db
      .prepare(
        `
        SELECT id, bank_slug, product_id, reason, raw_payload, recorded_at
        FROM quarantined_products
        ORDER BY id DESC
        LIMIT ?
      `,
      )
      .all(limit) as unknown as readonly QuarantinedRow[];

    return rows.map((r) => ({
      id: r.id,
      bankSlug: r.bank_slug,
      productId: r.product_id,
      reason: r.reason,
      rawPayload: r.raw_payload,
      recordedAt: r.recorded_at,
    }));
  }

  listBankStatuses(): readonly BankStatus[] {
    const rows = this.db
      .prepare(`SELECT * FROM bank_status ORDER BY bank_name ASC`)
      .all() as unknown as readonly BankStatusRow[];

    return rows.map((r) => ({
      bankSlug: r.bank_slug,
      bankName: r.bank_name,
      sourceUrl: r.source_url,
      cdrVersion: r.cdr_version,
      lastSyncedAt: r.last_synced_at,
      lastGoodSyncRunId: r.last_good_sync_run_id,
      degraded: r.degraded === 1,
      lastError: r.last_error,
      validProductCount: r.valid_product_count,
      quarantinedCount: r.quarantined_count,
    }));
  }

  getRateChanges(): readonly RateChange[] {
    const banks = this.listBankStatuses();
    const getLastTwoRuns = this.db.prepare(`
      SELECT id
      FROM sync_runs
      WHERE bank_slug = ? AND outcome = 'OK'
      ORDER BY id DESC
      LIMIT 2
    `);
    const getProductsForRun = this.db.prepare(`SELECT * FROM products WHERE sync_run_id = ?`);

    return banks.flatMap((bank): readonly RateChange[] => {
      const runs = getLastTwoRuns.all(bank.bankSlug) as unknown as readonly {
        readonly id: number;
      }[];
      const latestRunId = runs[0]?.id;
      const previousRunId = runs[1]?.id;
      if (latestRunId === undefined || previousRunId === undefined) return [];

      const latestProducts = (
        getProductsForRun.all(latestRunId) as unknown as readonly ProductRow[]
      ).map(mapProductRow);
      const prevProducts = (
        getProductsForRun.all(previousRunId) as unknown as readonly ProductRow[]
      ).map(mapProductRow);

      return computeRateDiffs(prevProducts, latestProducts);
    });
  }

  close(): void {
    this.db.close();
  }
}
