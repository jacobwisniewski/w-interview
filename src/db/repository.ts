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
  bankSlug: string;
  bankName: string;
  sourceUrl: string;
  cdrVersion: string;
  lastSyncedAt: string;
  lastGoodSyncRunId: number | null;
  degraded: boolean;
  lastError: string | null;
  validProductCount: number;
  quarantinedCount: number;
}

export interface ProductQueryFilters {
  bankSlug?: string;
  rateType?: PrimaryRateType;
  hasOffset?: boolean;
  hasRedraw?: boolean;
  reviewStatus?: ReviewStatus;
  search?: string;
}

export interface RecordSnapshotInput {
  bankSlug: string;
  bankName: string;
  sourceUrl: string;
  cdrVersion: string;
  source: SyncSource;
  capturedAt: string;
  products: NormalisedProduct[];
  quarantined: QuarantinedRecord[];
}

export interface RecordDegradedInput {
  bankSlug: string;
  bankName: string;
  sourceUrl: string;
  cdrVersion: string;
  source: SyncSource;
  attemptedAt: string;
  errorMessage: string;
}

export interface ProductRepository {
  recordSnapshot(input: RecordSnapshotInput): { syncRunId: number };
  recordDegradedSync(input: RecordDegradedInput): { syncRunId: number };
  listLatestProducts(filters?: ProductQueryFilters): NormalisedProduct[];
  getProductDetail(bankSlug: string, productId: string): NormalisedProduct | null;
  listQuarantined(limit?: number): Array<QuarantinedRecord & { id: number; recordedAt: string }>;
  listBankStatuses(): BankStatus[];
  getRateChanges(): RateChange[];
  close(): void;
}
