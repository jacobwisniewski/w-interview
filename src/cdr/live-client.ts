import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProductRepository } from "../db/repository.js";
import { validateAndNormaliseBatch } from "../domain/normalise.js";
import type { Logger } from "../logger.js";
import type { IngestSummary } from "./loader.js";

export interface BankRegistryEntry {
  readonly bankSlug: string;
  readonly bankName: string;
  readonly cdrVersion: string;
  readonly sourceUrl: string;
}

export interface LiveSyncOptions {
  readonly timeoutMs: number;
  readonly bankSlug?: string;
  readonly fetchFn?: typeof fetch;
  readonly manifestPath?: string;
}

const CANDIDATE_VERSIONS = ["7", "6", "5", "4", "3"] as const;

export function loadAllowedBanks(
  manifestPath = join(process.cwd(), "sample-data/manifest.json"),
): readonly BankRegistryEntry[] {
  const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    readonly banks?: readonly BankRegistryEntry[];
  };
  return raw.banks ?? [];
}

type FetchNegotiationResult =
  | { readonly ok: true; readonly version: string; readonly body: unknown }
  | { readonly ok: false; readonly error: string };

async function tryVersions(
  url: string,
  remainingVersions: readonly string[],
  timeoutMs: number,
  fetchFn: typeof fetch,
  lastError: string,
): Promise<FetchNegotiationResult> {
  const [version, ...rest] = remainingVersions;
  if (!version) {
    return { ok: false, error: lastError };
  }

  try {
    const response = await fetchFn(url, {
      headers: { "x-v": version, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (response.ok) {
      return { ok: true, version, body: await response.json() };
    }

    const error = `HTTP ${response.status} (x-v=${version})`;
    if (response.status === 406) {
      return tryVersions(url, rest, timeoutMs, fetchFn, error);
    }
    return { ok: false, error };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Network/timeout error: ${message}` };
  }
}

function fetchWithVersionNegotiation(
  url: string,
  preferredVersion: string,
  timeoutMs: number,
  fetchFn: typeof fetch,
): Promise<FetchNegotiationResult> {
  const versions = [preferredVersion, ...CANDIDATE_VERSIONS.filter((v) => v !== preferredVersion)];
  return tryVersions(url, versions, timeoutMs, fetchFn, "No supported CDR version found");
}

interface BankSyncOutcome {
  readonly banksProcessed: number;
  readonly banksDegraded: number;
  readonly validProducts: number;
  readonly quarantinedProducts: number;
}

async function syncSingleBank(
  bank: BankRegistryEntry,
  repo: ProductRepository,
  logger: Logger,
  timeoutMs: number,
  fetchFn: typeof fetch,
): Promise<BankSyncOutcome> {
  const attemptedAt = new Date().toISOString();
  const listUrl = `${bank.sourceUrl}?product-category=RESIDENTIAL_MORTGAGES&page-size=5`;
  const listResult = await fetchWithVersionNegotiation(
    listUrl,
    bank.cdrVersion,
    timeoutMs,
    fetchFn,
  );

  if (!listResult.ok) {
    repo.recordDegradedSync({
      bankSlug: bank.bankSlug,
      bankName: bank.bankName,
      sourceUrl: bank.sourceUrl,
      cdrVersion: bank.cdrVersion,
      source: "live",
      attemptedAt,
      errorMessage: listResult.error,
    });
    logger.warn("CDR live sync degraded; preserving last verified snapshot", {
      bankSlug: bank.bankSlug,
      error: listResult.error,
    });
    return { banksProcessed: 0, banksDegraded: 1, validProducts: 0, quarantinedProducts: 0 };
  }

  const listPayload = listResult.body as {
    readonly data?: {
      readonly products?: readonly {
        readonly productId?: string;
        readonly productCategory?: string;
      }[];
    };
  };
  const mortgages = (listPayload.data?.products ?? [])
    .filter((p) => p.productCategory === "RESIDENTIAL_MORTGAGES" && typeof p.productId === "string")
    .slice(0, 3);

  const detailResults = await Promise.all(
    mortgages.map((m) =>
      fetchWithVersionNegotiation(
        `${bank.sourceUrl}/${encodeURIComponent(m.productId!)}`,
        listResult.version,
        timeoutMs,
        fetchFn,
      ),
    ),
  );

  const successfulDetails = detailResults.filter(
    (r): r is Extract<FetchNegotiationResult, { readonly ok: true }> => r.ok,
  );
  const rawDetails = successfulDetails
    .map((r) => (r.body as { readonly data?: unknown }).data)
    .filter((d): d is unknown => d !== undefined);
  const detailVersion = successfulDetails[0]?.version ?? listResult.version;

  if (rawDetails.length === 0) {
    repo.recordDegradedSync({
      bankSlug: bank.bankSlug,
      bankName: bank.bankName,
      sourceUrl: bank.sourceUrl,
      cdrVersion: detailVersion,
      source: "live",
      attemptedAt,
      errorMessage: "No RESIDENTIAL_MORTGAGES product details returned by upstream CDR endpoint",
    });
    return { banksProcessed: 0, banksDegraded: 1, validProducts: 0, quarantinedProducts: 0 };
  }

  const { valid, quarantined } = validateAndNormaliseBatch(
    bank.bankSlug,
    bank.bankName,
    rawDetails,
  );
  repo.recordSnapshot({
    bankSlug: bank.bankSlug,
    bankName: bank.bankName,
    sourceUrl: bank.sourceUrl,
    cdrVersion: detailVersion,
    source: "live",
    capturedAt: attemptedAt,
    products: valid,
    quarantined,
  });

  return {
    banksProcessed: 1,
    banksDegraded: 0,
    validProducts: valid.length,
    quarantinedProducts: quarantined.length,
  };
}

export async function syncLiveBanks(
  repo: ProductRepository,
  logger: Logger,
  options: LiveSyncOptions,
): Promise<IngestSummary> {
  const fetchFn = options.fetchFn ?? fetch;
  const allowedBanks = loadAllowedBanks(options.manifestPath);
  const targets = options.bankSlug
    ? allowedBanks.filter((b) => b.bankSlug === options.bankSlug)
    : allowedBanks.slice(0, 5);

  if (options.bankSlug && targets.length === 0) {
    throw new Error(`Bank "${options.bankSlug}" is not in the allowlisted CDR manifest`);
  }

  const outcomes = await Promise.all(
    targets.map((bank) => syncSingleBank(bank, repo, logger, options.timeoutMs, fetchFn)),
  );

  const totals = outcomes.reduce<BankSyncOutcome>(
    (acc, item) => ({
      banksProcessed: acc.banksProcessed + item.banksProcessed,
      banksDegraded: acc.banksDegraded + item.banksDegraded,
      validProducts: acc.validProducts + item.validProducts,
      quarantinedProducts: acc.quarantinedProducts + item.quarantinedProducts,
    }),
    { banksProcessed: 0, banksDegraded: 0, validProducts: 0, quarantinedProducts: 0 },
  );

  return { mode: "live", ...totals };
}
