import PurchaseOrder from '../models/PurchaseOrder.js';
import GoodsReceipt from '../models/GoodReceipt.js';
import Invoice from '../models/Invoice.js';
import MatchResult from '../models/MatchResult.js';
import type { MatchStatus } from '../models/MatchResult.js';

// ─── Key normalization ────────────────────────────────────────────────────────

function normalizeDesc(desc: string): string {
  return desc
    .toLowerCase()
    .replace(/\b(psm|meatigo|rtc|frozen|fresh)\b/gi, '')  // strip brand prefixes
    .replace(/\d+\.?\d*\s*(g|kg|ml|l|pcs|pieces|pack|pkt|pc)\b/gi, '') // strip weights/sizes
    .replace(/\(.*?\)/g, '')  // strip parenthetical notes like "(5%)"
    .replace(/[^a-z\s]/g, '') // remove special chars
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 4)
    .join(' ');
}

// ─── PO map: keyed by numeric itemCode AND normalized description ─────────────

interface POEntry {
  qty: number;
  itemCode: string;
  description: string;
}

function buildPOMap(po: any): {
  byCode: Record<string, POEntry>;
  byDesc: Record<string, POEntry>;
} {
  const byCode: Record<string, POEntry> = {};
  const byDesc: Record<string, POEntry> = {};

  for (const item of po.items) {
    const code = item.itemCode?.toString().trim();
    const descKey = normalizeDesc(item.description ?? '');
    const entry: POEntry = {
      qty: (byCode[code]?.qty ?? 0) + (item.quantity ?? 0),
      itemCode: code,
      description: item.description ?? '',
    };
    if (code) byCode[code] = entry;
    if (descKey) byDesc[descKey] = entry;
  }
  return { byCode, byDesc };
}

// ─── GRN map: keyed by numeric SKU AND by normalized description ──────────────
// Each value holds both the numeric code AND desc key so we can reverse-lookup
// an invoice's FG-code → numeric GRN key

interface GRNEntry {
  qty: number;
  numericCode: string;
  description: string;
}

function buildGRNMap(grns: any[]): {
  byNumericCode: Record<string, GRNEntry>;
  byDesc: Record<string, GRNEntry>;
} {
  const byNumericCode: Record<string, GRNEntry> = {};
  const byDesc: Record<string, GRNEntry> = {};

  for (const grn of grns) {
    for (const item of grn.items ?? []) {
      const code = item.itemCode?.toString().trim(); // numeric, e.g. "11423"
      const descKey = normalizeDesc(item.description ?? '');

      if (code) {
        byNumericCode[code] = {
          qty: (byNumericCode[code]?.qty ?? 0) + (item.receivedQty ?? 0),
          numericCode: code,
          description: item.description ?? '',
        };
      }
      if (descKey) {
        // desc-keyed map — last writer wins if descriptions normalize to same key,
        // which is fine since we only need the qty
        byDesc[descKey] = {
          qty: (byDesc[descKey]?.qty ?? 0) + (item.receivedQty ?? 0),
          numericCode: code ?? '',
          description: item.description ?? '',
        };
      }
    }
  }
  return { byNumericCode, byDesc };
}

// ─── Invoice map: keyed by FG-code AND by normalized description ──────────────

interface InvoiceEntry {
  qty: number;
  itemCode: string;
  description: string;
}

function buildInvoiceMap(invoices: any[]): {
  byCode: Record<string, InvoiceEntry>;
  byDesc: Record<string, InvoiceEntry>;
} {
  const byCode: Record<string, InvoiceEntry> = {};
  const byDesc: Record<string, InvoiceEntry> = {};

  for (const inv of invoices) {
    for (const item of inv.items ?? []) {
      const code = item.itemCode?.toString().trim(); // e.g. "FG-P-F-0503"
      const descKey = normalizeDesc(item.description ?? '');

      if (code) {
        byCode[code] = {
          qty: (byCode[code]?.qty ?? 0) + (item.quantity ?? 0),
          itemCode: code,
          description: item.description ?? '',
        };
      }
      if (descKey) {
        byDesc[descKey] = {
          qty: (byDesc[descKey]?.qty ?? 0) + (item.quantity ?? 0),
          itemCode: code ?? '',
          description: item.description ?? '',
        };
      }
    }
  }
  return { byCode, byDesc };
}

// ─── Lookup helpers ───────────────────────────────────────────────────────────

// Resolve a GRN quantity given an INVOICE item (which may use a different code system)
function resolveGRNQty(
  invCode: string,
  invDesc: string,
  grnByNumeric: Record<string, GRNEntry>,
  grnByDesc: Record<string, GRNEntry>
): number {
  // Direct numeric match (won't work for FG codes, but future-safe)
  if (grnByNumeric[invCode]) return grnByNumeric[invCode]!.qty;
  // Description match (the main fallback for FG-code → numeric-code mapping)
  const descKey = normalizeDesc(invDesc);
  if (grnByDesc[descKey]) return grnByDesc[descKey]!.qty;
  // No match found
  return 0;
}

// Resolve a PO quantity given a GRN item (numeric code, or description fallback)
function resolvePOQty(
  grnCode: string,
  grnDesc: string,
  poByCode: Record<string, POEntry>,
  poByDesc: Record<string, POEntry>
): number | undefined {
  if (poByCode[grnCode] !== undefined) return poByCode[grnCode]!.qty;
  const descKey = normalizeDesc(grnDesc);
  if (poByDesc[descKey] !== undefined) return poByDesc[descKey]!.qty;
  return undefined;
}

// Resolve a PO quantity for an invoice item (FG-code side)
function resolvePOQtyForInvoice(
  invCode: string,
  invDesc: string,
  poByCode: Record<string, POEntry>,
  poByDesc: Record<string, POEntry>
): number | undefined {
  if (poByCode[invCode] !== undefined) return poByCode[invCode]!.qty;
  const descKey = normalizeDesc(invDesc);
  if (poByDesc[descKey] !== undefined) return poByDesc[descKey]!.qty;
  return undefined;
}

// ─── Upsert helper ────────────────────────────────────────────────────────────

async function upsertResult(
  poNumber: string,
  status: MatchStatus,
  mismatches: string[],
  linkedDocs: any
) {
  return MatchResult.findOneAndUpdate(
    { poNumber },
    { poNumber, status, mismatches, linkedDocs, checkedAt: new Date() },
    { upsert: true, new: true }
  );
}

// ─── Main match runner ────────────────────────────────────────────────────────

export async function runMatch(poNumber: string) {
  const po = await PurchaseOrder.findOne({ poNumber });
  const allGRNs = await GoodsReceipt.find({ poNumber });
  const allInvoices = await Invoice.find({ poNumber });

  if (!po) {
    return upsertResult(poNumber, 'insufficient_documents', [],
      { poId: null, grnIds: [], invoiceIds: [] });
  }

  if (allGRNs.length === 0 || allInvoices.length === 0) {
    return upsertResult(poNumber, 'insufficient_documents', [],
      { poId: po._id, grnIds: [], invoiceIds: [] });
  }

  // ── Deduplicate GRNs by grnNumber (keeps the latest upload) ──────────────
  // This is the fix for the "GRN uploaded twice" bug that causes every quantity
  // to be doubled. We group by grnNumber and keep the most recently uploaded one.
  const grnByNumber = new Map<string, any>();
  for (const grn of allGRNs) {
    const existing = grnByNumber.get(grn.grnNumber);
    if (!existing || grn.uploadedAt > existing.uploadedAt) {
      grnByNumber.set(grn.grnNumber, grn);
    }
  }
  const grns = [...grnByNumber.values()];

  // ── Deduplicate invoices by invoiceNumber (same reason) ──────────────────
  const invByNumber = new Map<string, any>();
  for (const inv of allInvoices) {
    const existing = invByNumber.get(inv.invoiceNumber);
    if (!existing || inv.uploadedAt > existing.uploadedAt) {
      invByNumber.set(inv.invoiceNumber, inv);
    }
  }
  const invoices = [...invByNumber.values()];

  // ── Build cross-referenced lookup maps ────────────────────────────────────
  const poMap = buildPOMap(po);
  const grnMap = buildGRNMap(grns);
  const invMap = buildInvoiceMap(invoices);

  const mismatches: string[] = [];

  // ── Rule 1: GRN receivedQty ≤ PO quantity (per SKU, using numeric codes) ──
  for (const [numCode, grnEntry] of Object.entries(grnMap.byNumericCode)) {
    const poQty = resolvePOQty(numCode, grnEntry.description, poMap.byCode, poMap.byDesc);
    if (poQty === undefined) {
      mismatches.push(`item_missing_in_po:${numCode}`);
    } else if (grnEntry.qty > poQty) {
      mismatches.push(
        `grn_qty_exceeds_po_qty:${numCode}:grn=${grnEntry.qty},po=${poQty}`
      );
    }
  }

  // ── Rule 2: Invoice quantity ≤ total GRN receivedQty (cross-code lookup) ──
  // Invoice uses FG codes → resolve via description to find the GRN numeric qty
  for (const [invCode, invEntry] of Object.entries(invMap.byCode)) {
    const grnQty = resolveGRNQty(
      invCode, invEntry.description,
      grnMap.byNumericCode, grnMap.byDesc
    );
    if (invEntry.qty > grnQty) {
      mismatches.push(
        `invoice_qty_exceeds_grn_qty:${invCode}:inv=${invEntry.qty},grn=${grnQty}`
      );
    }
  }

  // ── Rule 3: Invoice quantity ≤ PO quantity (cross-code lookup) ────────────
  for (const [invCode, invEntry] of Object.entries(invMap.byCode)) {
    const poQty = resolvePOQtyForInvoice(
      invCode, invEntry.description,
      poMap.byCode, poMap.byDesc
    );
    if (poQty !== undefined && invEntry.qty > poQty) {
      mismatches.push(
        `invoice_qty_exceeds_po_qty:${invCode}:inv=${invEntry.qty},po=${poQty}`
      );
    }
  }

  // ── Rule 4: Invoice date must not be after PO date ────────────────────────
  const poDate = new Date(po.poDate);
  for (const inv of invoices) {
    const invDate = new Date(inv.invoiceDate);
    if (invDate > poDate) {
      mismatches.push(
        `invoice_date_after_po_date:${inv.invoiceNumber}:inv=${invDate.toISOString().split('T')[0]},po=${poDate.toISOString().split('T')[0]}`
      );
    }
  }

  const status: MatchStatus = mismatches.length === 0 ? 'matched' : 'mismatch';

  return upsertResult(poNumber, status, mismatches, {
    poId: po._id,
    grnIds: grns.map((g) => g._id),
    invoiceIds: invoices.map((i) => i._id),
  });
}