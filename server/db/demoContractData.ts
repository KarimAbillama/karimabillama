/**
 * SYNTHETIC demo contracts, BOQs, budgets and programmes, shared by the demo seed (server/db/seed.ts)
 * and the clickable preview (preview/mockServer.ts) so both show the same figures. Dates are offsets
 * in days from today. Nothing here is a real contract, rate or programme.
 */

export type Cells = (string | number)[];
export const toCsv = (rows: Cells[]) =>
  rows.map((x) => x.map((v) => (/[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(",")).join("\n");

export interface DemoContract {
  project: "DEMO-101" | "DEMO-102";
  terms: {
    contractNo: string; title: string; form: string; signed: number; commencement: number; completion: number; contractValue: string; retentionPct: string;
    retentionLimitPct?: string; advancePct: string; ldPerDay: string; ldCapPct: string; defectsLiabilityMonths: number; paymentTermsDays: number; notes?: string;
  };
  securities: { kind: "performance_bond" | "advance_payment_guarantee" | "car_insurance" | "workmen_compensation"; reference: string; issuer: string; amount?: string; issued: number; expires: number }[];
  boqFile: string; boq: Cells[]; confirm: boolean;
  measurements: { at: number; qty: Record<string, string> }[];
  budget: { costCode: string; amount: string; note?: string }[];
}

export const DEMO_CONTRACTS: DemoContract[] = [
  {
    project: "DEMO-101",
    terms: {
      contractNo: "DEMO/CT/101", title: "Interior fit-out of residential tower, levels 1–30 (demo)", form: "FIDIC 1999 Red Book (amended) — demo", signed: -135,
      commencement: -120, completion: 240, contractValue: "18500000", retentionPct: "10", retentionLimitPct: "5", advancePct: "10", ldPerDay: "15000", ldCapPct: "10",
      defectsLiabilityMonths: 12, paymentTermsDays: 56, notes: "Synthetic demo contract. Payment certificates monthly; retention released half at completion, half after defects liability.",
    },
    securities: [
      { kind: "performance_bond", reference: "DEMO-PB-0101", issuer: "Demo Bank PJSC", amount: "1850000", issued: -130, expires: 24 },
      { kind: "advance_payment_guarantee", reference: "DEMO-APG-0101", issuer: "Demo Bank PJSC", amount: "1850000", issued: -130, expires: 200 },
      { kind: "car_insurance", reference: "DEMO-CAR-2026-77", issuer: "Demo Insurance Co.", amount: "18500000", issued: -125, expires: 300 },
      { kind: "workmen_compensation", reference: "DEMO-WC-2026-12", issuer: "Demo Insurance Co.", issued: -368, expires: -3 },
    ],
    boqFile: "DEMO-101 contract BOQ.csv", confirm: true,
    boq: [
      ["Ref", "Description", "Unit", "Quantity", "Rate", "Amount", "Cost code"],
      ["B1", "BILL 1 — PRELIMINARIES", "", "", "", "", ""],
      ["1.01", "Site establishment, offices and welfare", "LS", "", "", "420000", ""],
      ["1.02", "Site management and supervision", "month", "12", "110000", "1320000", ""],
      ["1.03", "Insurances and bonds", "LS", "", "", "259500", ""],
      ["B2", "BILL 2 — PARTITIONS AND CEILINGS", "", "", "", "", ""],
      ["2.01", "Blockwork partitions 100 mm, plastered both sides", "m2", "21000", "68", "1428000", "04-220"],
      ["2.02", "Gypsum board partitions, double layer, insulated", "m2", "18500", "115", "2127500", "09-210"],
      ["2.03", "Gypsum board ceilings including access panels", "m2", "26000", "85", "2210000", "09-210"],
      ["B3", "BILL 3 — FLOOR AND WALL FINISHES", "", "", "", "", ""],
      ["3.01", "Porcelain floor tiles 600 x 600 mm", "m2", "22000", "135", "2970000", "09-300"],
      ["3.02", "Ceramic wall tiles to wet areas", "m2", "14500", "110", "1595000", "09-300"],
      ["3.03", "Porcelain skirting 100 mm", "m", "30000", "28", "840000", "09-300"],
      ["B4", "BILL 4 — PAINTING", "", "", "", "", ""],
      ["4.01", "Emulsion paint to walls, three coats", "m2", "52000", "18", "936000", "09-900"],
      ["4.02", "Emulsion paint to ceilings", "m2", "26000", "14", "364000", "09-900"],
      ["B5", "BILL 5 — DOORS AND JOINERY", "", "", "", "", ""],
      ["5.01", "Apartment entrance doors, 60-minute fire rated", "nr", "240", "3400", "816000", ""],
      ["5.02", "Internal flush doors with ironmongery", "nr", "960", "1000", "960000", ""],
      ["B6", "BILL 6 — MEP FIT-OUT", "", "", "", "", ""],
      ["6.01", "Small power and lighting final circuits", "apartment", "240", "4200", "1008000", "26-050"],
      ["6.02", "Sanitary fixtures, supply and install", "set", "480", "1450", "696000", "22-110"],
      ["PS", "PROVISIONAL SUMS", "", "", "", "", ""],
      ["PS1", "Provisional sum: client-selected light fittings", "PS", "", "", "400000", ""],
      ["PS2", "Provisional sum: authority fees", "PS", "", "", "150000", ""],
    ],
    measurements: [
      { at: -31, qty: { "1.01": "1", "1.02": "3", "1.03": "1", "2.01": "11000", "2.02": "6000", "2.03": "3500", "3.01": "900" } },
      { at: -3, qty: { "1.02": "4", "2.01": "14500", "2.02": "9200", "2.03": "7400", "3.01": "3100", "3.02": "1800", "6.01": "70" } },
    ],
    budget: [
      { costCode: "04-220", amount: "1050000", note: "Blocks, mortar, labour (demo)" }, { costCode: "09-210", amount: "3200000" }, { costCode: "09-300", amount: "3900000" },
      { costCode: "09-900", amount: "850000" }, { costCode: "26-050", amount: "720000" }, { costCode: "22-110", amount: "560000" },
    ],
  },
  {
    project: "DEMO-102",
    terms: {
      contractNo: "DEMO/CT/102", title: "Landscape, hardscape and swimming pool (demo)", form: "Client bespoke — demo", signed: -70, commencement: -60, completion: 150,
      contractValue: "2750000", retentionPct: "5", advancePct: "0", ldPerDay: "2500", ldCapPct: "10", defectsLiabilityMonths: 12, paymentTermsDays: 30,
    },
    securities: [{ kind: "performance_bond", reference: "DEMO-PB-0102", issuer: "Demo Bank PJSC", amount: "275000", issued: -65, expires: 240 }],
    boqFile: "DEMO-102 BOQ (from tender).csv", confirm: false, measurements: [], budget: [],
    boq: [
      ["Item", "Description", "Unit", "Qty", "Rate", "Amount", "Cost code"],
      ["1", "PRELIMINARIES", "", "", "", "", ""],
      ["1.01", "Preliminaries and site facilities", "LS", "", "", "254800", ""],
      ["2", "HARDSCAPE", "", "", "", "", ""],
      ["2.01", "Excavation and disposal", "m3", "1800", "38", "68400", ""],
      ["2.02", "Granular sub-base 200 mm", "m2", "2400", "42", "100800", "32-140"],
      ["2.03", "Interlock paving 80 mm", "m2", "2900", "118", "342200", "32-140"],
      ["2.04", "Precast kerbs", "m", "650", "85", "55250", "32-140"],
      ["2.05", "Natural stone pool coping", "m", "140", "420", "58800", "32-140"],
      ["3", "SWIMMING POOL", "", "", "", "", ""],
      ["3.01", "Reinforced concrete pool shell", "m3", "95", "1650", "156750", "13-110"],
      ["3.02", "Pool waterproofing", "m2", "420", "145", "60900", "13-110"],
      ["3.03", "Glass mosaic pool tiling", "m2", "380", "395", "150100", "13-110"],
      ["3.04", "Filtration plant and pool equipment", "LS", "", "", "410000", "13-110"],
      ["4", "IRRIGATION", "", "", "", "", ""],
      ["4.01", "Irrigation mains and drip lines", "m", "3600", "46", "165600", "32-840"],
      ["4.02", "Controllers and valve boxes", "nr", "12", "4800", "57600", "32-840"],
      ["5", "SOFTSCAPE", "", "", "", "", ""],
      ["5.01", "Topsoil and planting mix", "m3", "900", "165", "148500", "32-900"],
      ["5.02", "Date palms, 4 m clear trunk", "nr", "36", "6500", "234000", "32-900"],
      ["5.03", "Shrubs and groundcover", "m2", "1600", "95", "152000", "32-900"],
      ["5.04", "Turf", "m2", "1100", "48", "52800", "32-900"],
      ["6", "EXTERNAL LIGHTING", "", "", "", "", ""],
      ["6.01", "Landscape lighting points", "nr", "85", "1900", "161500", "26-050"],
      ["PS1", "Provisional sum: outdoor kitchen by client's specialist", "PS", "", "", "120000", ""],
    ],
  },
];

export type DemoActivity = [code: string, name: string, wbs: string, start: number, finish: number, type?: string];
/** [activity, actual start, actual finish (null = still running), % on the last snapshot] */
export type DemoProgress = [code: string, start: number, finish: number | null, finalPct: number];
export interface DemoProgramme { project: "DEMO-101" | "DEMO-102"; fileName: string; activities: DemoActivity[]; snapshots: number[]; progress: DemoProgress[] }

export const DEMO_PROGRAMMES: DemoProgramme[] = [
  {
    project: "DEMO-101", fileName: "DEMO-101 BL0 (P6 export).csv",
    activities: [
      ["M000", "Start of fit-out works", "", -120, -120, "Start Milestone"],
      ["A1010", "Mobilisation and site set-up", "PRE", -120, -106],
      ["A1100", "Blockwork and partitions L1–10", "PART", -110, -60], ["A1110", "Blockwork and partitions L11–20", "PART", -80, -30], ["A1120", "Blockwork and partitions L21–30", "PART", -50, 0],
      ["A1200", "MEP first fix L1–10", "MEP", -90, -40], ["A1210", "MEP first fix L11–20", "MEP", -60, -10], ["A1220", "MEP first fix L21–30", "MEP", -30, 20],
      ["A1300", "Gypsum ceilings L1–10", "CEIL", -45, -5], ["A1310", "Gypsum ceilings L11–20", "CEIL", -15, 25], ["A1320", "Gypsum ceilings L21–30", "CEIL", 15, 55],
      ["A1400", "Floor and wall tiling L1–10", "FIN", -30, 20], ["A1410", "Floor and wall tiling L11–20", "FIN", 10, 60], ["A1420", "Floor and wall tiling L21–30", "FIN", 40, 90],
      ["A1500", "Painting L1–30", "FIN", 30, 150], ["A1600", "Doors and joinery L1–30", "JOIN", 60, 170], ["A1700", "MEP second fix and sanitary fixtures", "MEP", 80, 180],
      ["A1800", "Testing and commissioning", "T&C", 170, 215], ["A1900", "Snagging and handover", "HO", 195, 219],
      ["M999", "Practical completion (20 days float to contract completion)", "", 220, 220, "Finish Milestone"],
    ],
    snapshots: [-110, -90, -75, -60, -45, -30, -14, -3],
    progress: [
      ["M000", -120, -120, 100], ["A1010", -120, -104, 100], ["A1100", -108, -56, 100], ["A1110", -79, null, 95], ["A1120", -48, null, 45],
      ["A1200", -89, -38, 100], ["A1210", -59, null, 85], ["A1220", -27, null, 25], ["A1300", -43, null, 92], ["A1310", -12, null, 15], ["A1400", -28, null, 35],
    ],
  },
  {
    project: "DEMO-102", fileName: "DEMO-102 BL0.csv",
    activities: [
      ["M000", "Start of works", "", -60, -60, "Start Milestone"],
      ["B100", "Site clearance and setting out", "SITE", -60, -50], ["B200", "Excavation and pool shell", "POOL", -50, -15], ["B300", "Irrigation mains and sleeves", "IRR", -40, -10],
      ["B400", "Hardscape sub-base", "HARD", -20, 15], ["B500", "Interlock paving and kerbs", "HARD", 5, 60], ["B600", "Pool waterproofing and tiling", "POOL", -10, 30],
      ["B700", "Pool MEP and equipment", "POOL", 20, 70], ["B800", "Softscape and planting", "SOFT", 60, 120], ["B900", "Landscape lighting and external power", "ELEC", 50, 110],
      ["B950", "Testing, cleaning and handover", "HO", 120, 148], ["M999", "Completion", "", 150, 150, "Finish Milestone"],
    ],
    snapshots: [-45, -30, -15, -6],
    progress: [["M000", -60, -60, 100], ["B100", -60, -47, 100], ["B200", -48, null, 60], ["B300", -35, null, 30]],
  },
];

export const baselineCsv = (p: DemoProgramme, d: (n: number) => string) => toCsv([
  ["Activity ID", "Activity Name", "WBS Code", "Start", "Finish", "Activity Type"],
  ...p.activities.map(([c, n, w, s0, f0, t]) => [c, n, w, d(s0), d(f0), t ?? "Task Dependent"]),
]);

/** Progress rows per snapshot: each started activity rises evenly to its % on the last snapshot. */
export function progressSnapshots(p: DemoProgramme, d: (n: number) => string) {
  const last = p.snapshots[p.snapshots.length - 1];
  return p.snapshots.map((at) => ({
    asOfDate: d(at),
    rows: p.progress.filter(([, s0]) => s0 <= at).map(([activityCode, s0, f0, pct]) => {
      const done = f0 !== null && at >= f0;
      const v = done ? 100 : f0 !== null ? Math.min(99, Math.round((100 * (at - s0 + 1)) / (f0 - s0 + 1))) : Math.max(1, Math.round((pct * (at - s0 + 1)) / (last - s0 + 1)));
      return { activityCode, pctComplete: String(v), actualStart: d(s0), actualFinish: done ? d(f0!) : null, remark: null as string | null };
    }),
  }));
}
