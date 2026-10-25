/**
 * VAT treatment codes for purchase lines.
 * STATUS: UNVERIFIED PLACEHOLDER. The rates below reflect the commonly published UAE standard rate
 * but must be confirmed by EDGE's accountant against current FTA guidance before any figure is used
 * for tax reporting. Treatment is selected per line — it is never applied blindly.
 * Source to check: https://tax.gov.ae/en/taxes/vat/guides.references.aspx
 */
export const VAT_CODES = {
  SR: { label: "Standard rated", rate: "5.00" },
  ZR: { label: "Zero rated", rate: "0.00" },
  EX: { label: "Exempt", rate: "0.00" },
  OOS: { label: "Out of scope", rate: "0.00" },
} as const;
export type VatCode = keyof typeof VAT_CODES;
export const VAT_VERIFIED = false;
