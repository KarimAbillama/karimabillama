import Decimal from "decimal.js";

// Fixed-precision arithmetic for money and quantities. Never use JS floats for these.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
export type DecimalLike = Decimal.Value;

export const dec = (v: DecimalLike | null | undefined) => new Decimal(v ?? 0);
/** Quantity as a 4-decimal string (matches numeric(18,4)). */
export const q4 = (v: DecimalLike) => new Decimal(v).toDecimalPlaces(4).toFixed(4);
/** Money as a 2-decimal string (matches numeric(18,2)). */
export const m2 = (v: DecimalLike) => new Decimal(v).toDecimalPlaces(2).toFixed(2);
export const min = (...vals: DecimalLike[]) => Decimal.min(...vals);
export const max = (...vals: DecimalLike[]) => Decimal.max(...vals);
export const sum = (vals: DecimalLike[]) => vals.reduce<Decimal>((a, v) => a.plus(v), new Decimal(0));
