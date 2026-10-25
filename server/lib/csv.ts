/**
 * CSV export with spreadsheet formula-injection protection: any cell that starts with
 * = + - @ tab or carriage return is prefixed with a single quote so Excel treats it as text.
 * Numeric strings (e.g. "-12.50") are left as numbers.
 */
const NUMERIC = /^-?\d+(\.\d+)?$/;

export function safeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !NUMERIC.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv<T extends Record<string, unknown>>(rows: T[], columns: { key: keyof T; header: string }[]): string {
  const head = columns.map((c) => safeCell(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => safeCell(r[c.key])).join(","));
  // BOM so Excel opens UTF-8 (Arabic names etc.) correctly.
  return "﻿" + [head, ...body].join("\r\n") + "\r\n";
}
