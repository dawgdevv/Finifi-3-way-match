import PurchaseOrder from '../models/PurchaseOrder.js';
import GoodsReceipt from '../models/GoodReceipt.js';
import Invoice from '../models/Invoice.js';
import MatchResult from '../models/MatchResult.js';
import type { MatchStatus, IShortfallItem } from '../models/MatchResult.js';

/* ------------------------------------------------------------------ */
/*  0.  Levenshtein distance (iterative DP, O(n·m))                   */
/* ------------------------------------------------------------------ */

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const prev = new Array(n + 1);
  const curr = new Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ca = a[i - 1];
    for (let j = 1; j <= n; j++) {
      const cb = b[j - 1];
      curr[j] =
        ca === cb
          ? prev[j - 1]
          : 1 + Math.min(prev[j - 1], curr[j - 1], prev[j]);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

function similarity(a: string, b: string): number {
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

/* ------------------------------------------------------------------ */
/*  1.  Description cleaner – produces a canonical comparable string   */
/* ------------------------------------------------------------------ */

const ABBREVS: Record<string, string> = {
  veg: 'vegetable',
  vg: 'vegetable',
  chkn: 'chicken',
  chk: 'chicken',
  pcs: 'pieces',
  pc: 'piece',
  pkt: 'packet',
  pk: 'pack',
  pck: 'pack',
  minis: 'mini',
  wings: 'wing',
  drumsticks: 'drumstick',
  springrolls: 'springroll',
  rolls: 'roll',
  sausages: 'sausage',
  cheeses: 'cheese',
  hams: 'ham',
  bacons: 'bacon',
  kebabs: 'kebab',
  salamis: 'salami',
  fillets: 'fillet',
  kheema: 'keema',
  cuts: 'cut',
};

const DICT = new Set([
  'psm', 'meatigo', 'rtc',
  'cheesy', 'spicy', 'vegetable', 'paneer',
  'chicken', 'pork', 'fish',
  'momos', 'spring', 'roll',
  'sausage', 'salami', 'ham', 'bacon',
  'wing', 'drumstick',
  'keema', 'kebab', 'tikka', 'fillet',
  'frozen', 'whole', 'wheat', 'super', 'saver',
  'cheese', 'original', 'chinese', 'peri', 'tandoori',
  'pepper', 'herb', 'chilli',
  'mini', 'english', 'breakfast', 'everyday', 'plain',
  'seekh', 'kabab', 'boneless', 'breast', 'curry', 'cut', 'skinless',
  'pizza', 'chef', 'fschef',
  'onion', 'hot', 'mince',
  'pack',
]);

function cleanDescription(raw: string): string {
  if (!raw) return '';
  let s = raw.toLowerCase();

  /* strip noise */
  s = s.replace(/colour:size:sizebrand:band[_\s]?\w*/gi, '');
  s = s.replace(/colour:size:sizebrand:/gi, '');
  s = s.replace(/\(frozen\)|\(\d+%\)|\(mince\)/gi, '');
  s = s.replace(/brand:\w+/gi, '');

  /* expand abbreviations (longest first to avoid double-expansion) */
  const abbrKeys = Object.keys(ABBREVS).sort((a, b) => b.length - a.length);
  const abbrRe = new RegExp(abbrKeys.join('|'), 'g');
  s = s.replace(abbrRe, (m) => ABBREVS[m] ?? m);

  /* normalise unit patterns so pack-size numbers stay intact */
  // e.g. 24.0pieces / 24pcs / 24 pc → 24pieces
  s = s.replace(/(\d+\.?\d*)\s*(pieces|pcs|pack|pkt|pc)\b/gi, '$1pieces');
  // e.g. 250.0g / 250 g / 1.0kg / 1 kg → 250g / 1kg
  s = s.replace(/(\d+\.?\d*)\s*(g|kg|ml|l)\b/gi, '$1$2');

  /* keep letters + numbers; collapse whitespace */
  s = s.replace(/[^a-z0-9]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  return s;
}

/**
 * Greedy dictionary segmentation of a concatenated word.
 * Example: "psmcheesyspicyvegetablemomos" →
 *          ["psm","cheesy","spicy","vegetable","momos"]
 */
function segmentWord(word: string): string[] {
  const out: string[] = [];
  let remaining = word;

  while (remaining.length > 0) {
    let found = false;
    const maxLen = Math.min(remaining.length, 20);
    for (let len = maxLen; len >= 2; len--) {
      const sub = remaining.substring(0, len);
      if (DICT.has(sub)) {
        out.push(sub);
        remaining = remaining.substring(len);
        found = true;
        break;
      }
    }
    if (!found) remaining = remaining.substring(1); // skip unknown char
  }

  return out.length ? out : [word];
}

/** Build a canonical signature: segmented words sorted alphabetically. */
function canonicalSignature(raw: string): string {
  const cleaned = cleanDescription(raw);
  const tokens = cleaned.split(' ').filter((w) => w.length > 2);
  const segmented = tokens.flatMap(segmentWord);
  const unique = [...new Set(segmented)].sort();
  return unique.join(' ');
}

/* ------------------------------------------------------------------ */
/*  2.  Rich item maps                                                */
/* ------------------------------------------------------------------ */

interface RichItem {
  qty: number;
  desc: string;
  canon: string;
}

type RichMap = Record<string, RichItem>;

function buildRichMap(items: any[], qtyField: string): RichMap {
  const map: RichMap = {};
  for (const item of items || []) {
    const code = item.itemCode?.toString().trim();
    if (!code) continue;
    map[code] = {
      qty: item[qtyField] ?? 0,
      desc: item.description || '',
      canon: canonicalSignature(item.description || ''),
    };
  }
  return map;
}

/* ------------------------------------------------------------------ */
/*  3.  Cross-reference resolver (invoice → PO / GRN)                  */
/* ------------------------------------------------------------------ */

const SIMILARITY_THRESHOLD = 0.65;
const QTY_EXACT_BONUS = 0.15;
const QTY_CLOSE_BONUS = 0.08;

function resolveItemCode(
  itemCode: string,
  description: string,
  numericSku: string,
  invQty: number,
  targetMap: RichMap
): string | undefined {
  const cleanCode = itemCode?.toString().trim();
  const cleanNum = numericSku?.toString().trim();
  const invCanon = canonicalSignature(description);

  /* 3a – exact itemCode */
  if (cleanCode && targetMap[cleanCode]) return cleanCode;

  /* 3b – numericSku bridge */
  if (cleanNum && targetMap[cleanNum]) return cleanNum;

  /* 3c – exact canonical signature */
  const exactCanon = Object.keys(targetMap).find(
    (k) => targetMap[k].canon === invCanon
  );
  if (exactCanon) return exactCanon;

  /* 3d – Levenshtein-based fuzzy match with quantity tie-breaker */
  let bestCode: string | undefined;
  let bestScore = -1;
  let bestDescSim = 0;

  for (const [code, { canon, qty: poQty }] of Object.entries(targetMap)) {
    if (!canon || !invCanon) continue;
    const descSim = similarity(canon, invCanon);

    /* quantity tie-breaker: exact match is a strong signal */
    const qtyDiff = Math.abs(poQty - invQty);
    const qtyBonus =
      qtyDiff === 0 ? QTY_EXACT_BONUS : qtyDiff <= 10 ? QTY_CLOSE_BONUS : 0;

    const score = descSim + qtyBonus;
    if (score > bestScore) {
      bestScore = score;
      bestCode = code;
      bestDescSim = descSim;
    }
  }

  /* we still require the *base* description similarity to pass threshold */
  if (bestCode && bestDescSim >= SIMILARITY_THRESHOLD) return bestCode;
  return undefined;
}

/* ------------------------------------------------------------------ */
/*  4.  Align PO / GRN / Invoice into unified rows                     */
/* ------------------------------------------------------------------ */

interface UnifiedItem {
  code: string;
  bestDesc: string;
  poQty: number;
  grnQty: number;
  invQty: number;
}

function alignDocuments(
  po: any,
  grns: any[],
  invoices: any[]
): UnifiedItem[] {
  const rows = new Map<string, UnifiedItem>();

  /* ---- PO items --------------------------------------------------- */
  const poMap = buildRichMap(po.items, 'quantity');
  for (const [code, { qty, desc }] of Object.entries(poMap)) {
    rows.set(code, {
      code,
      bestDesc: desc,
      poQty: qty,
      grnQty: 0,
      invQty: 0,
    });
  }

  /* ---- GRN items (usually share PO itemCode) ---------------------- */
  for (const grn of grns) {
    const grnMap = buildRichMap(grn.items, 'receivedQty');
    for (const [code, { qty, desc }] of Object.entries(grnMap)) {
      if (rows.has(code)) {
        rows.get(code)!.grnQty += qty;
        if (!rows.get(code)!.bestDesc) rows.get(code)!.bestDesc = desc;
      } else {
        rows.set(code, {
          code,
          bestDesc: desc,
          poQty: 0,
          grnQty: qty,
          invQty: 0,
        });
      }
    }
  }

  /* ---- Invoice items ---------------------------------------------- */
  for (const inv of invoices) {
    const invMap = buildRichMap(inv.items, 'quantity');
    for (const [code, { qty, desc }] of Object.entries(invMap)) {
      const numericSku =
        inv.items.find((it: any) => it.itemCode === code)?.numericSku ?? '';

      const matchedCode = resolveItemCode(code, desc, numericSku, qty, poMap) ??
                         resolveItemCode(code, desc, numericSku, qty, buildRichMap(grns.flatMap((g) => g.items || []), 'receivedQty'));

      if (matchedCode && rows.has(matchedCode)) {
        rows.get(matchedCode)!.invQty += qty;
        if (!rows.get(matchedCode)!.bestDesc) rows.get(matchedCode)!.bestDesc = desc;
      } else {
        // Unmatched invoice line (new product not in PO/GRN)
        rows.set(`INV-${code}`, {
          code: `INV-${code}`,
          bestDesc: desc,
          poQty: 0,
          grnQty: 0,
          invQty: qty,
        });
      }
    }
  }

  return Array.from(rows.values());
}

/* ------------------------------------------------------------------ */
/*  5.  Validation rules                                               */
/* ------------------------------------------------------------------ */

interface RuleOutput {
  status: MatchStatus;
  mismatches: string[];
  ruleResults: {
    grn_qty_exceeds_po_qty: boolean;
    invoice_qty_exceeds_po_qty: boolean;
    invoice_qty_exceeds_grn_qty: boolean;
    invoice_date_before_po_date: boolean;
    duplicate_po: boolean;
    item_missing_in_po: boolean;
  };
  shortfallItems: IShortfallItem[];
  reasons: string[];
}

function runRules(
  unified: UnifiedItem[],
  po: any,
  invoices: any[]
): RuleOutput {
  const mismatches: string[] = [];
  const ruleResults = {
    grn_qty_exceeds_po_qty: false,
    invoice_qty_exceeds_po_qty: false,
    invoice_qty_exceeds_grn_qty: false,
    invoice_date_before_po_date: false,
    duplicate_po: false,
    item_missing_in_po: false,
  };

  const shortfallItems: IShortfallItem[] = [];

  for (const u of unified) {
    const desc = u.bestDesc || u.code;
    const shortfall = Math.max(0, u.poQty - u.grnQty);

    const hasDiscrepancy =
      shortfall > 0 ||
      u.invQty > u.grnQty ||
      u.grnQty > u.poQty ||
      (u.poQty === 0 && (u.grnQty > 0 || u.invQty > 0));

    if (hasDiscrepancy) {
      shortfallItems.push({
        itemCode: u.code,
        description: desc,
        poQty: u.poQty,
        grnQty: u.grnQty,
        invoiceQty: u.invQty,
        shortfall,
      });
    }

    if (u.grnQty > u.poQty) {
      mismatches.push(
        `grn_qty_exceeds_po_qty:${u.code}:grn=${u.grnQty},po=${u.poQty}`
      );
      ruleResults.grn_qty_exceeds_po_qty = true;
    }

    if (u.invQty > u.grnQty) {
      mismatches.push(
        `invoice_qty_exceeds_grn_qty:${u.code}:inv=${u.invQty},grn=${u.grnQty}`
      );
      ruleResults.invoice_qty_exceeds_grn_qty = true;
    }

    if (u.poQty > 0 && u.invQty > u.poQty) {
      mismatches.push(
        `invoice_qty_exceeds_po_qty:${u.code}:inv=${u.invQty},po=${u.poQty}`
      );
      ruleResults.invoice_qty_exceeds_po_qty = true;
    }

    if (u.poQty === 0 && (u.grnQty > 0 || u.invQty > 0)) {
      mismatches.push(`item_missing_in_po:${u.code}`);
      ruleResults.item_missing_in_po = true;
    }
  }

  const poDate = new Date(po.poDate);
  for (const inv of invoices) {
    const invDate = new Date(inv.invoiceDate);
    if (invDate < poDate) {
      mismatches.push(
        `invoice_date_before_po_date:${inv.invoiceNumber}:date=${invDate.toISOString().split('T')[0]}`
      );
      ruleResults.invoice_date_before_po_date = true;
    }
  }

  const reasons: string[] = [];
  if (ruleResults.grn_qty_exceeds_po_qty) reasons.push('grn_qty_exceeds_po_qty');
  if (ruleResults.invoice_qty_exceeds_po_qty) reasons.push('invoice_qty_exceeds_po_qty');
  if (ruleResults.invoice_qty_exceeds_grn_qty) reasons.push('invoice_qty_exceeds_grn_qty');
  if (ruleResults.invoice_date_before_po_date) reasons.push('invoice_date_before_po_date');
  if (ruleResults.item_missing_in_po) reasons.push('item_missing_in_po');

  let status: MatchStatus;
  if (mismatches.length === 0) {
    status = 'matched';
  } else if (unified.some((u) => u.invQty > 0 && u.invQty <= u.grnQty && u.grnQty <= u.poQty)) {
    status = 'partially_matched';
  } else {
    status = 'mismatch';
  }

  return { status, mismatches, ruleResults, shortfallItems, reasons };
}

/* ------------------------------------------------------------------ */
/*  6.  Persistence helpers                                            */
/* ------------------------------------------------------------------ */

async function upsertResult(
  poNumber: string,
  status: MatchStatus,
  mismatches: string[],
  linkedDocs: any,
  ruleResults: RuleOutput['ruleResults'],
  shortfallItems: IShortfallItem[],
  reasons: string[],
  summary: any
) {
  const decision =
    status === 'matched'
      ? 'All validation rules passed. Documents are fully matched.'
      : 'One or more validation rules failed. Review mismatches for details.';

  return MatchResult.findOneAndUpdate(
    { poNumber },
    {
      poNumber,
      status,
      mismatches,
      linkedDocs,
      ruleResults,
      shortfallItems,
      reasons,
      decision,
      summary,
      checkedAt: new Date(),
    },
    { upsert: true, new: true }
  );
}

/* ------------------------------------------------------------------ */
/*  7.  Public entry point                                             */
/* ------------------------------------------------------------------ */

export async function runMatch(poNumber: string) {
  const po = await PurchaseOrder.findOne({ poNumber });
  const grns = await GoodsReceipt.find({ poNumber });
  const invoices = await Invoice.find({ poNumber });

  /* ---- insufficient documents -------------------------------------- */
  if (!po) {
    return upsertResult(
      poNumber,
      'insufficient_documents',
      [],
      { poId: null, grnIds: [], invoiceIds: [] },
      {
        grn_qty_exceeds_po_qty: false,
        invoice_qty_exceeds_po_qty: false,
        invoice_qty_exceeds_grn_qty: false,
        invoice_date_before_po_date: false,
        duplicate_po: false,
        item_missing_in_po: false,
      },
      [],
      [],
      {
        poQty: 0,
        grnReceivedQty: 0,
        invoiceQty: 0,
        shortReceivedQty: 0,
        shortInvoicedQty: 0,
        poDate: '',
        grnDate: null,
        invoiceDate: null,
        invoiceNumber: null,
      }
    );
  }

  if (grns.length === 0 || invoices.length === 0) {
    const poQty = po.items.reduce((sum: number, it: any) => sum + (it.quantity || 0), 0);
    return upsertResult(
      poNumber,
      'insufficient_documents',
      [],
      {
        poId: po._id,
        grnIds: grns.map((g: any) => g._id),
        invoiceIds: invoices.map((i: any) => i._id),
      },
      {
        grn_qty_exceeds_po_qty: false,
        invoice_qty_exceeds_po_qty: false,
        invoice_qty_exceeds_grn_qty: false,
        invoice_date_before_po_date: false,
        duplicate_po: false,
        item_missing_in_po: false,
      },
      [],
      [],
      {
        poQty,
        grnReceivedQty: 0,
        invoiceQty: 0,
        shortReceivedQty: 0,
        shortInvoicedQty: 0,
        poDate: po.poDate.toISOString().split('T')[0],
        grnDate: grns[0]?.grnDate?.toISOString().split('T')[0] || null,
        invoiceDate: invoices[0]?.invoiceDate?.toISOString().split('T')[0] || null,
        invoiceNumber: invoices[0]?.invoiceNumber || null,
      }
    );
  }

  /* ---- align and validate ----------------------------------------- */
  const unified = alignDocuments(po, grns, invoices);
  const { status, mismatches, ruleResults, shortfallItems, reasons } = runRules(
    unified,
    po,
    invoices
  );

  /* ---- summary ---------------------------------------------------- */
  const poQty = unified.reduce((s, u) => s + u.poQty, 0);
  const grnReceivedQty = unified.reduce((s, u) => s + u.grnQty, 0);
  const invoiceQty = unified.reduce((s, u) => s + u.invQty, 0);
  const shortReceivedQty = unified.reduce((s, u) => s + Math.max(0, u.poQty - u.grnQty), 0);
  const shortInvoicedQty = unified.reduce((s, u) => s + Math.max(0, u.poQty - u.invQty), 0);

  const summary = {
    poQty,
    grnReceivedQty,
    invoiceQty,
    shortReceivedQty,
    shortInvoicedQty,
    poDate: po.poDate.toISOString().split('T')[0],
    grnDate: grns[0]?.grnDate?.toISOString().split('T')[0] || null,
    invoiceDate: invoices[0]?.invoiceDate?.toISOString().split('T')[0] || null,
    invoiceNumber: invoices[0]?.invoiceNumber || null,
  };

  return upsertResult(
    poNumber,
    status,
    mismatches,
    {
      poId: po._id,
      grnIds: grns.map((g: any) => g._id),
      invoiceIds: invoices.map((i: any) => i._id),
    },
    ruleResults,
    shortfallItems,
    reasons,
    summary
  );
}
