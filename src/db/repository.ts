import type {
  NormalisedProduct,
  PrimaryRateType,
  QuarantinedRecord,
  RateChange,
  ReviewStatus,
} from "../domain/normalise.js";

export type SyncSource = "snapshot" | "live";
export type SyncOutcome = "OK" | "DEGRADED";

export interface BankStatus {
  readonly bankSlug: string;
  readonly bankName: string;
  readonly sourceUrl: string;
  readonly cdrVersion: string;
  readonly lastSyncedAt: string;
  readonly lastGoodSyncRunId: number | null;
  readonly degraded: boolean;
  readonly lastError: string | null;
  readonly validProductCount: number;
  readonly quarantinedCount: number;
}

export interface ProductQueryFilters {
  readonly bankSlug?: string;
  readonly rateType?: PrimaryRateType;
  readonly hasOffset?: boolean;
  readonly hasRedraw?: boolean;
  readonly reviewStatus?: ReviewStatus;
  readonly search?: string;
}

export interface RecordSnapshotInput {
  readonly bankSlug: string;
  readonly bankName: string;
  readonly sourceUrl: string;
  readonly cdrVersion: string;
  readonly source: SyncSource;
  readonly capturedAt: string;
  readonly products: readonly NormalisedProduct[];
  readonly quarantined: readonly QuarantinedRecord[];
}

export interface RecordDegradedInput {
  readonly bankSlug: string;
  readonly bankName: string;
  readonly sourceUrl: string;
  readonly cdrVersion: string;
  readonly source: SyncSource;
  readonly attemptedAt: string;
  readonly errorMessage: string;
}

export interface ProductRepository {
  recordSnapshot(input: RecordSnapshotInput): { readonly syncRunId: number };
  recordDegradedSync(input: RecordDegradedInput): { readonly syncRunId: number };
  listLatestProducts(filters?: ProductQueryFilters): readonly NormalisedProduct[];
  getProductDetail(bankSlug: string, productId: string): NormalisedProduct | null;
  listQuarantined(
    limit?: number,
  ): readonly Array<
    QuarantinedRecord & { readonly id: number; readonly recordedAt: string }
  >[number][];
  listBankStatuses(): readonly BankStatus[];
  getRateChanges(): readonly RateChange[];
  close(): void;
}
