import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { and, asc, desc, eq, or, sql, type SQL } from "drizzle-orm";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { computeRateDiffs } from "../domain/diff.js";
import type {
  NormalisedProduct,
  PrimaryRateType,
  QuarantinedRecord,
  RateChange,
  ReviewStatus,
} from "../domain/types.js";
import type {
  BankStatus,
  ProductQueryFilters,
  ProductRepository,
  RecordDegradedInput,
  RecordSnapshotInput,
} from "./repository.js";
import * as schema from "./schema.js";

type ProductRow = typeof schema.products.$inferSelect;

function mapProductRow(row: ProductRow): NormalisedProduct {
  return {
    bankSlug: row.bankSlug,
    bankName: row.bankName,
    productId: row.productId,
    name: row.name,
    description: row.description,
    lastUpdated: row.lastUpdated,
    overviewUri: row.overviewUri,
    rateType: row.rateType as PrimaryRateType,
    headlineRatePct: row.headlineRatePct,
    comparisonRatePct: row.comparisonRatePct,
    annualFeeCents: row.annualFeeCents,
    upfrontFeeCents: row.upfrontFeeCents,
    hasOffset: row.hasOffset,
    hasRedraw: row.hasRedraw,
    reviewStatus: row.reviewStatus as ReviewStatus,
    reviewReasons: JSON.parse(row.reviewReasonsJson) as readonly string[],
    rawRateCount: row.rawRateCount,
  };
}

function buildFilterConditions(filters: ProductQueryFilters): readonly SQL[] {
  const searchTerm = filters.search ? `%${filters.search.toLowerCase()}%` : null;
  const searchClause = searchTerm
    ? or(
        sql`LOWER(${schema.products.name}) LIKE ${searchTerm}`,
        sql`LOWER(${schema.products.bankName}) LIKE ${searchTerm}`,
      )
    : undefined;

  return [
    eq(schema.products.syncRunId, schema.bankStatus.lastGoodSyncRunId),
    ...(filters.bankSlug ? [eq(schema.products.bankSlug, filters.bankSlug)] : []),
    ...(filters.rateType ? [eq(schema.products.rateType, filters.rateType)] : []),
    ...(filters.hasOffset !== undefined ? [eq(schema.products.hasOffset, filters.hasOffset)] : []),
    ...(filters.hasRedraw !== undefined ? [eq(schema.products.hasRedraw, filters.hasRedraw)] : []),
    ...(filters.reviewStatus ? [eq(schema.products.reviewStatus, filters.reviewStatus)] : []),
    ...(searchClause ? [searchClause] : []),
  ];
}

export class SqliteProductRepository implements ProductRepository {
  private readonly sqlite: Database.Database;
  private readonly db: BetterSQLite3Database<typeof schema>;

  constructor(dbPath: string, migrationsFolder = join(process.cwd(), "drizzle")) {
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.sqlite = new Database(dbPath);
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.pragma("foreign_keys = ON");
    this.db = drizzle(this.sqlite, { schema });
    migrate(this.db, { migrationsFolder });
  }

  recordSnapshot(input: RecordSnapshotInput): { readonly syncRunId: number } {
    return this.db.transaction((tx) => {
      const insertedRun = tx
        .insert(schema.syncRuns)
        .values({
          bankSlug: input.bankSlug,
          bankName: input.bankName,
          source: input.source,
          outcome: "OK",
          cdrVersion: input.cdrVersion,
          capturedAt: input.capturedAt,
          validCount: input.products.length,
          quarantinedCount: input.quarantined.length,
        })
        .returning({ id: schema.syncRuns.id })
        .get();

      const syncRunId = insertedRun.id;

      if (input.products.length > 0) {
        tx.insert(schema.products)
          .values(
            input.products.map((p) => ({
              syncRunId,
              bankSlug: p.bankSlug,
              bankName: p.bankName,
              productId: p.productId,
              name: p.name,
              description: p.description,
              lastUpdated: p.lastUpdated,
              overviewUri: p.overviewUri,
              rateType: p.rateType,
              headlineRatePct: p.headlineRatePct,
              comparisonRatePct: p.comparisonRatePct,
              annualFeeCents: p.annualFeeCents,
              upfrontFeeCents: p.upfrontFeeCents,
              hasOffset: p.hasOffset,
              hasRedraw: p.hasRedraw,
              reviewStatus: p.reviewStatus,
              reviewReasonsJson: JSON.stringify(p.reviewReasons),
              rawRateCount: p.rawRateCount,
            })),
          )
          .run();
      }

      if (input.quarantined.length > 0) {
        tx.insert(schema.quarantinedProducts)
          .values(
            input.quarantined.map((q) => ({
              syncRunId,
              bankSlug: q.bankSlug,
              productId: q.productId,
              reason: q.reason,
              rawPayload: q.rawPayload,
              recordedAt: input.capturedAt,
            })),
          )
          .run();
      }

      tx.insert(schema.bankStatus)
        .values({
          bankSlug: input.bankSlug,
          bankName: input.bankName,
          sourceUrl: input.sourceUrl,
          cdrVersion: input.cdrVersion,
          lastSyncedAt: input.capturedAt,
          lastGoodSyncRunId: syncRunId,
          degraded: false,
          lastError: null,
          validProductCount: input.products.length,
          quarantinedCount: input.quarantined.length,
        })
        .onConflictDoUpdate({
          target: schema.bankStatus.bankSlug,
          set: {
            bankName: input.bankName,
            sourceUrl: input.sourceUrl,
            cdrVersion: input.cdrVersion,
            lastSyncedAt: input.capturedAt,
            lastGoodSyncRunId: syncRunId,
            degraded: false,
            lastError: null,
            validProductCount: input.products.length,
            quarantinedCount: input.quarantined.length,
          },
        })
        .run();

      return { syncRunId };
    });
  }

  recordDegradedSync(input: RecordDegradedInput): { readonly syncRunId: number } {
    return this.db.transaction((tx) => {
      const insertedRun = tx
        .insert(schema.syncRuns)
        .values({
          bankSlug: input.bankSlug,
          bankName: input.bankName,
          source: input.source,
          outcome: "DEGRADED",
          cdrVersion: input.cdrVersion,
          capturedAt: input.attemptedAt,
          validCount: 0,
          quarantinedCount: 0,
          errorMessage: input.errorMessage,
        })
        .returning({ id: schema.syncRuns.id })
        .get();

      tx.insert(schema.bankStatus)
        .values({
          bankSlug: input.bankSlug,
          bankName: input.bankName,
          sourceUrl: input.sourceUrl,
          cdrVersion: input.cdrVersion,
          lastSyncedAt: input.attemptedAt,
          lastGoodSyncRunId: null,
          degraded: true,
          lastError: input.errorMessage,
          validProductCount: 0,
          quarantinedCount: 0,
        })
        .onConflictDoUpdate({
          target: schema.bankStatus.bankSlug,
          set: {
            degraded: true,
            lastError: input.errorMessage,
          },
        })
        .run();

      return { syncRunId: insertedRun.id };
    });
  }

  listLatestProducts(filters: ProductQueryFilters = {}): readonly NormalisedProduct[] {
    const conditions = buildFilterConditions(filters);
    const rows = this.db
      .select({ product: schema.products })
      .from(schema.products)
      .innerJoin(schema.bankStatus, eq(schema.bankStatus.bankSlug, schema.products.bankSlug))
      .where(and(...conditions))
      .orderBy(
        asc(sql`CASE WHEN ${schema.products.reviewStatus} = 'READY' THEN 0 ELSE 1 END`),
        asc(sql`COALESCE(${schema.products.comparisonRatePct}, 999)`),
        asc(schema.products.bankName),
        asc(schema.products.name),
      )
      .all();

    return rows.map((r) => mapProductRow(r.product));
  }

  getProductDetail(bankSlug: string, productId: string): NormalisedProduct | null {
    const row = this.db
      .select({ product: schema.products })
      .from(schema.products)
      .innerJoin(schema.bankStatus, eq(schema.bankStatus.bankSlug, schema.products.bankSlug))
      .where(
        and(
          eq(schema.products.syncRunId, schema.bankStatus.lastGoodSyncRunId),
          eq(schema.products.bankSlug, bankSlug),
          eq(schema.products.productId, productId),
        ),
      )
      .limit(1)
      .get();

    return row ? mapProductRow(row.product) : null;
  }

  listQuarantined(
    limit = 50,
  ): readonly Array<
    QuarantinedRecord & { readonly id: number; readonly recordedAt: string }
  >[number][] {
    return this.db
      .select({
        id: schema.quarantinedProducts.id,
        bankSlug: schema.quarantinedProducts.bankSlug,
        productId: schema.quarantinedProducts.productId,
        reason: schema.quarantinedProducts.reason,
        rawPayload: schema.quarantinedProducts.rawPayload,
        recordedAt: schema.quarantinedProducts.recordedAt,
      })
      .from(schema.quarantinedProducts)
      .orderBy(desc(schema.quarantinedProducts.id))
      .limit(limit)
      .all();
  }

  listBankStatuses(): readonly BankStatus[] {
    return this.db.select().from(schema.bankStatus).orderBy(asc(schema.bankStatus.bankName)).all();
  }

  getRateChanges(): readonly RateChange[] {
    const banks = this.listBankStatuses();

    return banks.flatMap((bank): readonly RateChange[] => {
      const runs = this.db
        .select({ id: schema.syncRuns.id })
        .from(schema.syncRuns)
        .where(and(eq(schema.syncRuns.bankSlug, bank.bankSlug), eq(schema.syncRuns.outcome, "OK")))
        .orderBy(desc(schema.syncRuns.id))
        .limit(2)
        .all();

      const latestRunId = runs[0]?.id;
      const previousRunId = runs[1]?.id;
      if (latestRunId === undefined || previousRunId === undefined) return [];

      const latestProducts = this.db
        .select()
        .from(schema.products)
        .where(eq(schema.products.syncRunId, latestRunId))
        .all()
        .map(mapProductRow);

      const prevProducts = this.db
        .select()
        .from(schema.products)
        .where(eq(schema.products.syncRunId, previousRunId))
        .all()
        .map(mapProductRow);

      return computeRateDiffs(prevProducts, latestProducts);
    });
  }

  close(): void {
    this.sqlite.close();
  }
}
