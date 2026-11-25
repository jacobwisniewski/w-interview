import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProductRepository } from "../db/repository.js";
import { validateAndNormaliseBatch } from "../domain/normalise.js";
import type { Logger } from "../logger.js";
import type { IngestSummary } from "./loader.js";

export interface BankRegistryEntry {
  bankSlug: string;
  bankName: string;
  cdrVersion: string;
  sourceUrl: string;
}

export interface LiveSyncOptions {
  timeoutMs: number;
  bankSlug?: string;
  fetchFn?: typeof fetch;
  manifestPath?: string;
}

const CANDIDATE_VERSIONS = ["7", "6", "5", "4", "3"];

export function loadAllowedBanks(
  manifestPath = join(process.cwd(), "sample-data/manifest.json"),
): BankRegistryEntry[] {
  const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as { banks?: BankRegistryEntry[] };
  return raw.banks ?? [];
}

async function fetchWithVersionNegotiation(
  url: string,
  preferredVersion: string,
  timeoutMs: number,
  fetchFn: typeof fetch,
): Promise<{ ok: true; version: string; body: unknown } | { ok: false; error: string }> {
  const versions = [preferredVersion, ...CANDIDATE_VERSIONS.filter((v) => v !== preferredVersion)];
  let lastError = "No supported CDR version found";

  for (const version of versions) {
    try {
      const response = await fetchFn(url, {
        headers: {
          "x-v": version,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.ok) {
        const body = await response.json();
        return { ok: true, version, body };
      }

      lastError = `HTTP ${response.status} (x-v=${version})`;
      // Only retry other x-v versions on 406 UnsupportedVersion
      if (response.status !== 406) {
        return { ok: false, error: lastError };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Network/timeout error: ${message}` };
    }
  }

  return { ok: false, error: lastError };
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

  let banksProcessed = 0;
  let banksDegraded = 0;
  let validProducts = 0;
  let quarantinedProducts = 0;

  for (const bank of targets) {
    const attemptedAt = new Date().toISOString();
    const listUrl = `${bank.sourceUrl}?product-category=RESIDENTIAL_MORTGAGES&page-size=5`;
    const listResult = await fetchWithVersionNegotiation(
      listUrl,
      bank.cdrVersion,
      options.timeoutMs,
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
      banksDegraded += 1;
      logger.warn("CDR live sync degraded; preserving last verified snapshot", {
        bankSlug: bank.bankSlug,
        error: listResult.error,
      });
      continue;
    }

    const listPayload = listResult.body as {
      data?: { products?: Array<{ productId?: string; productCategory?: string }> };
    };
    const mortgages = (listPayload.data?.products ?? [])
      .filter(
        (p) => p.productCategory === "RESIDENTIAL_MORTGAGES" && typeof p.productId === "string",
      )
      .slice(0, 3);

    const rawDetails: unknown[] = [];
    let detailVersion = listResult.version;
    for (const m of mortgages) {
      const detailUrl = `${bank.sourceUrl}/${encodeURIComponent(m.productId!)}`;
      const detailResult = await fetchWithVersionNegotiation(
        detailUrl,
        detailVersion,
        options.timeoutMs,
        fetchFn,
      );
      if (detailResult.ok) {
        detailVersion = detailResult.version;
        const detailData = (detailResult.body as { data?: unknown }).data;
        if (detailData) rawDetails.push(detailData);
      }
    }

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
      banksDegraded += 1;
      continue;
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

    banksProcessed += 1;
    validProducts += valid.length;
    quarantinedProducts += quarantined.length;
  }

  return {
    mode: "live",
    banksProcessed,
    banksDegraded,
    validProducts,
    quarantinedProducts,
  };
}
