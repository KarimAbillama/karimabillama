/**
 * Reading a Bill of Quantities saved from Excel as CSV (pure, no database).
 *
 * Columns (header names are flexible, see BOQ_COLUMNS): Ref, Description, Unit, Quantity, Rate,
 * Amount, and optionally Cost code. How each row is read (A-45):
 *  - no unit, quantity, rate or amount → a heading (bill, section or sub-heading);
 *  - unit "PS" / "Prov sum" → a provisional sum: only the amount is needed;
 *  - an amount with no quantity and no rate → a lump sum: quantity 1, rate = amount;
 *  - otherwise an item: quantity and rate are needed; if the amount is also given it must equal
 *    quantity × rate (within AED 1, for Excel rounding).
 */
import { Decimal, dec, m2, q4 } from "./decimal.js";
import { normalisedRows, pickColumn } from "./p6.js";

export type BoqKind = "heading" | "item" | "provisional_sum";
export interface ParsedBoqLine {
  lineNo: number; kind: BoqKind; ref: string | null; description: string; unit: string | null;
  qty: string | null; rate: string | null; amount: string | null; costCode: string | null; section: string | null;
}

export const BOQ_COLUMNS = {
  ref: ["ref", "item", "item_no", "item_ref", "no", "s_no", "sr_no"],
  description: ["description", "item_description", "desc", "particulars"],
  unit: ["unit", "uom", "units"],
  qty: ["quantity", "qty"],
  rate: ["rate", "unit_rate", "rate_aed"],
  amount: ["amount", "total", "amount_aed", "total_aed"],
  costCode: ["cost_code", "costcode"],
};

const PS_UNITS = ["ps", "p.s.", "p.s", "prov sum", "provisional sum", "pc sum", "pc"];

const numberOrNull = (v: string | undefined): Decimal | null | "bad" => {
  if (v === undefined || v.trim() === "" || v.trim() === "-") return null;
  const t = v.replace(/,/g, "").replace(/^AED\s*/i, "").trim();
  return /^-?\d+(\.\d+)?$/.test(t) ? dec(t) : "bad";
};

export const MAX_BOQ_LINES = 10000;

export function parseBoqCsv(text: string): { lines: ParsedBoqLine[]; problems: string[]; total: string } {
  const rows = normalisedRows(text);
  const problems: string[] = [];
  const lines: ParsedBoqLine[] = [];
  if (!rows.length) return { lines, problems: ["The file has no rows. Save the BOQ sheet from Excel as \"CSV UTF-8\"."], total: "0.00" };
  if (!BOQ_COLUMNS.description.some((c) => c in rows[0])) return { lines, problems: ["No \"Description\" column found. Columns needed: Ref, Description, Unit, Quantity, Rate, Amount."], total: "0.00" };
  if (rows.length > MAX_BOQ_LINES) return { lines, problems: [`The BOQ has ${rows.length} rows; the limit is ${MAX_BOQ_LINES}.`], total: "0.00" };
  let section: string | null = null;
  let total = dec(0);
  rows.forEach((r, i) => {
    const at = `Row ${i + 2}`;
    const ref = pickColumn(r, BOQ_COLUMNS.ref)?.trim() || null;
    const description = pickColumn(r, BOQ_COLUMNS.description)?.trim() ?? "";
    const unit = pickColumn(r, BOQ_COLUMNS.unit)?.trim() || null;
    const qty = numberOrNull(pickColumn(r, BOQ_COLUMNS.qty));
    const rate = numberOrNull(pickColumn(r, BOQ_COLUMNS.rate));
    const amount = numberOrNull(pickColumn(r, BOQ_COLUMNS.amount));
    const costCode = pickColumn(r, BOQ_COLUMNS.costCode)?.trim() || null;
    const label = `${at}${ref ? ` (${ref})` : ""}`;
    if (qty === "bad" || rate === "bad" || amount === "bad") { problems.push(`${label}: quantity, rate and amount must be numbers.`); return; }
    if (!description && !ref) return; // spacer row
    if (!description) { problems.push(`${label}: description is empty.`); return; }
    const base = { lineNo: lines.length + 1, ref, description, costCode, section };
    if (!unit && qty === null && rate === null && amount === null) {
      section = description;
      lines.push({ ...base, kind: "heading", unit: null, qty: null, rate: null, amount: null, costCode: null, section: null });
      return;
    }
    if (unit && PS_UNITS.includes(unit.toLowerCase())) {
      const a = amount ?? (qty !== null && rate !== null ? qty.times(rate) : null);
      if (a === null) { problems.push(`${label}: a provisional sum needs an amount.`); return; }
      total = total.plus(m2(a));
      lines.push({ ...base, kind: "provisional_sum", unit: "PS", qty: null, rate: null, amount: m2(a) });
      return;
    }
    let q = qty, rt = rate;
    if (q === null && rt === null && amount !== null) { q = dec(1); rt = amount; }
    if (!unit) { problems.push(`${label}: unit is empty.`); return; }
    if (q === null || rt === null) { problems.push(`${label}: quantity and rate are needed for an item.`); return; }
    if (q.lte(0)) { problems.push(`${label}: quantity must be more than 0.`); return; }
    if (rt.lt(0)) { problems.push(`${label}: rate cannot be negative.`); return; }
    const computed = dec(m2(q.times(rt)));
    if (amount !== null && computed.minus(amount).abs().gt(1)) {
      problems.push(`${label}: amount ${m2(amount)} is not quantity × rate (${q4(q)} × ${rt.toString()} = ${computed.toFixed(2)}).`);
      return;
    }
    total = total.plus(computed);
    lines.push({ ...base, kind: "item", unit, qty: q4(q), rate: q4(rt), amount: computed.toFixed(2) });
  });
  if (!lines.some((l) => l.kind !== "heading") && !problems.length) problems.push("No priced items found.");
  return { lines, problems, total: m2(total) };
}
