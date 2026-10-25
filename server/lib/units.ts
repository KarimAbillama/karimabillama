import { Decimal, dec } from "./decimal.js";
import { rule } from "./errors.js";

export interface UnitDef {
  code: string;
  dimension: string;
  factorToReference: string | null;
}

export interface ItemUnitContext {
  itemCode: string;
  baseUnit: string;
  /** item-specific: base units contained in one of `unitCode` */
  conversions: { unitCode: string; baseUnitsPerUnit: string }[];
  units: UnitDef[];
}

/**
 * Converts a quantity in `unitCode` into the item's base unit.
 *  1. Same unit → unchanged.
 *  2. Item-specific conversion (e.g. 1 bag = 50 kg) → multiply.
 *  3. Same physical dimension with standard factors (t → kg, mm → m) → scale.
 *  Anything else (e.g. m2 → kg without an item factor) is rejected rather than guessed.
 */
export function toBaseQty(ctx: ItemUnitContext, unitCode: string, qty: Decimal.Value): Decimal {
  const q = dec(qty);
  if (unitCode === ctx.baseUnit) return q;
  const conv = ctx.conversions.find((c) => c.unitCode === unitCode);
  if (conv) return q.times(conv.baseUnitsPerUnit);
  const from = ctx.units.find((u) => u.code === unitCode);
  const to = ctx.units.find((u) => u.code === ctx.baseUnit);
  if (!from || !to) throw rule("UNKNOWN_UNIT", `Unknown unit "${unitCode}"`);
  if (from.dimension === to.dimension && from.factorToReference && to.factorToReference) {
    return q.times(from.factorToReference).dividedBy(to.factorToReference);
  }
  throw rule(
    "INVALID_UNIT_CONVERSION",
    `Cannot convert ${unitCode} to ${ctx.baseUnit} for item ${ctx.itemCode}: no item-specific conversion is defined and the units measure different things (${from.dimension} vs ${to.dimension}).`,
  );
}
