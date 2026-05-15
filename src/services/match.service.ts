import PurchaseOrder from '../models/PurchaseOrder.js';
import GoodsReceipt from '../models/GoodReceipt.js';
import Invoice from '../models/Invoice.js';
import MatchResult from '../models/MatchResult.js';
import type { MatchStatus } from '../models/MatchResult.js'
function buildPOMap(po: any): {
  byCode: Record<string, number>;
  byDesc: Record<string, number>;  // normalized description → qty
} {
  const byCode: Record<string, number> = {};
  const byDesc: Record<string, number> = {};
  
  for (const item of po.items) {
    const code = item.itemCode?.toString().trim();
    if (code) byCode[code] = (byCode[code] || 0) + item.quantity;
    
    // Normalize description: lowercase, remove size/weight suffixes, collapse spaces
    const descKey = normalizeDesc(item.description);
    if (descKey) byDesc[descKey] = (byDesc[descKey] || 0) + item.quantity;
  }
  return { byCode, byDesc };
}

function normalizeDesc(desc: string): string {
  return desc
    .toLowerCase()
    .replace(/\d+\.?\d*\s*(g|kg|ml|l|pcs|pieces|pack|pkt)\b/gi, '') // strip weights
    .replace(/[^a-z\s]/g, '')  // remove special chars
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 4)  // first 4 meaningful words
    .join(' ');
}

function lookupPOQty(
  itemCode: string,
  description: string,
  poByCode: Record<string, number>,
  poByDesc: Record<string, number>
): number | undefined {
  // Strategy 1: exact itemCode match
  if (poByCode[itemCode] !== undefined) return poByCode[itemCode];
  
  // Strategy 2: description-based match
  const descKey = normalizeDesc(description);
  if (poByDesc[descKey] !== undefined) return poByDesc[descKey];
  
  // Strategy 3: partial itemCode (some ERPs pad codes differently)
  const partialMatch = Object.keys(poByCode).find(k => 
    k.includes(itemCode) || itemCode.includes(k)
  );
  if (partialMatch) return poByCode[partialMatch];
  
  return undefined;
}

function aggregateGRN(grns: any[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const grn of grns) {
    for (const item of grn.items || []) {
      const code = item.itemCode?.toString().trim();
      if (code) {
        map[code] = (map[code] || 0) + (item.receivedQty || 0);
      }
    }
  }
  return map;
}

function aggregateInvoice(invoices: any[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const inv of invoices) {
    for (const item of inv.items || []) {
      const code = item.itemCode?.toString().trim();
      if (code) {
        map[code] = (map[code] || 0) + (item.quantity || 0);
      }
    }
  }
  return map;
}

async function upsertResult(
  poNumber: string,
  status: MatchStatus,
  mismatches: string[],
  linkedDocs: any
) {
  return MatchResult.findOneAndUpdate(
    { poNumber },
    {
      poNumber,
      status,
      mismatches,
      linkedDocs,
      checkedAt: new Date(),
    },
    { upsert: true, new: true }
  );
}

export async function runMatch(poNumber: string) {
  const po = await PurchaseOrder.findOne({ poNumber });
  const grns = await GoodsReceipt.find({ poNumber });
  const invoices = await Invoice.find({ poNumber });

  // Insufficient documents check
  if (!po) {
    return upsertResult(poNumber, 'insufficient_documents', [], { poId: null, grnIds: [], invoiceIds: [] });
  }

  if (grns.length === 0 || invoices.length === 0) {
    return upsertResult(poNumber, 'insufficient_documents', [], {
      poId: po._id,
      grnIds: [],
      invoiceIds: [],
    });
  }

  const mismatches: string[] = [];

  // Build lookup maps
  const poMap = buildPOMap(po);
  const grnMap = aggregateGRN(grns);
  const invoiceMap = aggregateInvoice(invoices);

  // Rule 1: GRN qty <= PO qty for each SKU
  for (const [sku, grnQty] of Object.entries(grnMap)) {
    const poQty = lookupPOQty(sku, grnMap[sku]?.description || '', poMap.byCode, poMap.byDesc);
    if (poQty === undefined) {
      mismatches.push(`item_missing_in_po:${sku}`);
    } else if (grnQty > poQty) {
      mismatches.push(`grn_qty_exceeds_po_qty:${sku}:grn=${grnQty},po=${poQty}`);
    }
  }

  // Rule 2: Invoice qty <= GRN qty for each SKU
  for (const [sku, invQty] of Object.entries(invoiceMap)) {
    const grnQty = grnMap[sku] ?? 0;
    if (invQty > grnQty) {
      mismatches.push(`invoice_qty_exceeds_grn_qty:${sku}:inv=${invQty},grn=${grnQty}`);
    }
  }

  // Rule 3: Invoice qty <= PO qty for each SKU
  for (const [sku, invQty] of Object.entries(invoiceMap)) {
    const poQty = poMap.byCode[sku];
    if (poQty !== undefined && invQty > poQty) {
      mismatches.push(`invoice_qty_exceeds_po_qty:${sku}:inv=${invQty},po=${poQty}`);
    }
  }

  // Rule 4: Invoice date <= PO date
  const poDate = new Date(po.poDate);
  for (const inv of invoices) {
    const invDate = new Date(inv.invoiceDate);
    if (invDate < poDate) {
      mismatches.push(`invoice_date_before_po_date:${inv.invoiceNumber}:date=${invDate.toISOString().split('T')[0]}`);
    }
  }

  // Determine status
  let status: MatchStatus;
  if (mismatches.length === 0) {
    status = 'matched';
  } else {
    status = 'mismatch';
  }

  return upsertResult(poNumber, status, mismatches, {
    poId: po._id,
    grnIds: grns.map((g) => g._id),
    invoiceIds: invoices.map((i) => i._id),
  });
}
