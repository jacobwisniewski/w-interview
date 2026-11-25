import { z } from "zod";

export const CdrFeatureSchema = z
  .object({
    featureType: z.string().min(1),
    additionalValue: z.string().nullable().optional(),
    additionalInfo: z.string().nullable().optional(),
    additionalInfoUri: z.string().nullable().optional(),
  })
  .passthrough();

export const CdrFeeSchema = z
  .object({
    name: z.string().min(1),
    feeType: z.string().min(1),
    amount: z.string().nullable().optional(),
    balanceRate: z.string().nullable().optional(),
    transactionRate: z.string().nullable().optional(),
    currency: z.string().nullable().optional(),
    additionalValue: z.string().nullable().optional(),
    additionalInfo: z.string().nullable().optional(),
  })
  .passthrough();

export const CdrLendingRateSchema = z
  .object({
    lendingRateType: z.string().min(1),
    rate: z.string().min(1),
    comparisonRate: z.string().nullable().optional(),
    calculationFrequency: z.string().nullable().optional(),
    applicationFrequency: z.string().nullable().optional(),
    interestPaymentDue: z.string().nullable().optional(),
    repaymentType: z.string().nullable().optional(),
    loanPurpose: z.string().nullable().optional(),
    additionalValue: z.string().nullable().optional(),
    additionalInfo: z.string().nullable().optional(),
  })
  .passthrough();

export const CdrProductDetailSchema = z
  .object({
    productId: z.string().min(1),
    productCategory: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional().default(""),
    brand: z.string().optional(),
    brandName: z.string().nullable().optional(),
    lastUpdated: z.string().optional(),
    additionalInformation: z
      .object({
        overviewUri: z.string().nullable().optional(),
        termsUri: z.string().nullable().optional(),
        eligibilityUri: z.string().nullable().optional(),
        feesAndPricingUri: z.string().nullable().optional(),
      })
      .passthrough()
      .optional(),
    features: z.array(CdrFeatureSchema).optional().default([]),
    fees: z.array(CdrFeeSchema).optional().default([]),
    lendingRates: z.array(CdrLendingRateSchema).optional().default([]),
  })
  .passthrough();

export const BankSnapshotSchema = z.object({
  bankSlug: z.string().min(1),
  bankName: z.string().min(1),
  sourceUrl: z.string().min(1),
  cdrVersion: z.string().min(1),
  capturedAt: z.string().min(1),
  products: z.array(z.unknown()),
});

export type CdrProductDetail = z.infer<typeof CdrProductDetailSchema>;
export type CdrLendingRate = z.infer<typeof CdrLendingRateSchema>;
export type BankSnapshotEnvelope = z.infer<typeof BankSnapshotSchema>;
