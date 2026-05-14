import PurchaseOrder from '../models/PurchaseOrder.js';
import GoodsReceipt from '../models/GoodReceipt.js';
import Invoice from '../models/Invoice.js';
import MatchResult from '../models/MatchResult.js';
import type { MatchStatus } from '../models/MatchResult.js'
function buildMap(items: any[], qtyField: string): Record<string, number> {
  const map: Record<string, number> = {};
  for (const item of items) {
    const code = item.itemCode?.toString().trim();
    if (code) {
      map[code] = (map[code] || 0) + (item[qtyField] || 0);
    }
  }
  return map;
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
  const poMap = buildMap(po.items, 'quantity');
  const grnMap = aggregateGRN(grns);
  const invoiceMap = aggregateInvoice(invoices);

  // Rule 1: GRN qty <= PO qty for each SKU
  for (const [sku, grnQty] of Object.entries(grnMap)) {
    const poQty = poMap[sku];
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
    const poQty = poMap[sku];
    if (poQty !== undefined && invQty > poQty) {
      mismatches.push(`invoice_qty_exceeds_po_qty:${sku}:inv=${invQty},po=${poQty}`);
    }
  }

  // Rule 4: Invoice date <= PO date
  const poDate = new Date(po.poDate);
  for (const inv of invoices) {
    const invDate = new Date(inv.invoiceDate);
    if (invDate > poDate) {
      mismatches.push(`invoice_date_after_po_date:${inv.invoiceNumber}:date=${invDate.toISOString().split('T')[0]}`);
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
