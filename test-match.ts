/**
 * Stand-alone test for the Levenshtein-based matching logic with qty tie-breaker.
 * Run with: npx ts-node test-match.ts
 */

/* ------------------------------------------------------------------ */
/*  Levenshtein + canonical signature (inline copies)                   */
/* ------------------------------------------------------------------ */

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
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
      curr[j] = ca === cb ? prev[j - 1] : 1 + Math.min(prev[j - 1], curr[j - 1], prev[j]);
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

const ABBREVS: Record<string, string> = {
  veg: 'vegetable', vg: 'vegetable',
  chkn: 'chicken', chk: 'chicken',
  pcs: 'pieces', pc: 'piece',
  pkt: 'packet', pk: 'pack', pck: 'pack',
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
  s = s.replace(/colour:size:sizebrand:band[_\s]?\w*/gi, '');
  s = s.replace(/colour:size:sizebrand:/gi, '');
  s = s.replace(/\(frozen\)|\(\d+%\)|\(mince\)/gi, '');
  s = s.replace(/brand:\w+/gi, '');
  const abbrKeys = Object.keys(ABBREVS).sort((a, b) => b.length - a.length);
  s = s.replace(new RegExp(abbrKeys.join('|'), 'g'), (m) => ABBREVS[m] ?? m);
  s = s.replace(/(\d+\.?\d*)\s*(pieces|pcs|pack|pkt|pc)\b/gi, '$1pieces');
  s = s.replace(/(\d+\.?\d*)\s*(g|kg|ml|l)\b/gi, '$1$2');
  s = s.replace(/[^a-z0-9]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

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
    if (!found) remaining = remaining.substring(1);
  }
  return out.length ? out : [word];
}

function canonicalSignature(raw: string): string {
  const cleaned = cleanDescription(raw);
  const tokens = cleaned.split(' ').filter((w) => w.length > 2);
  const segmented = tokens.flatMap(segmentWord);
  const unique = [...new Set(segmented)].sort();
  return unique.join(' ');
}

/* ------------------------------------------------------------------ */
/*  Sample data                                                         */
/* ------------------------------------------------------------------ */

const poItems = [
  { itemCode: '11423', description: 'psmcheesyspicyvegmomos24.0piecescolour:size:sizebrand:band2', quantity: 50 },
  { itemCode: '11797', description: 'meatigohotwings250.0gcolour:size:sizebrand:band_3', quantity: 75 },
  { itemCode: '18003', description: 'meatigochickencurrycutskinlessfrozen450.0gcolour:size:sizebrand:band_1', quantity: 120 },
  { itemCode: '18004', description: 'meatigochickenbonelessbreastfrozen450.0gcolour:size:sizebrand:band_1', quantity: 540 },
  { itemCode: '18906', description: 'psmspringrollsvegfrozen240.0gcolour:size:sizebrand:band_4', quantity: 175 },
  { itemCode: '253430', description: 'psmporksalami200.0gcolour:size:sizebrand:', quantity: 75 },
  { itemCode: '33387', description: 'psmfrozenchickenchillisalami200.0gcolour:size:sizebrand:torso', quantity: 75 },
  { itemCode: '33388', description: 'psmfrozenchickenpepperonisalami100.0gcolour:size:sizebrand:band_3', quantity: 120 },
  { itemCode: '33390', description: 'psmchickenseekhkebab500.0gcolour:size:sizebrand:band_3', quantity: 272 },
  { itemCode: '398656', description: 'meatigochickendrumsticks450.0gcolour:size:sizebrand:', quantity: 270 },
  { itemCode: '414867', description: 'psmchinesevegspringrolls240.0gcolour:size:sizebrand:', quantity: 25 },
  { itemCode: '432518', description: 'meatigochickenkheema450.0gcolour:size:sizebrand:', quantity: 360 },
  { itemCode: '4459', description: 'psmoriginalchickenmomos24.0piecescolour:size:sizebrand:band_1', quantity: 475 },
  { itemCode: '4460', description: 'psmspicychickenmomos24.0piecescolour:size:sizebrand:band_1', quantity: 325 },
  { itemCode: '4461', description: 'psmveg&paneermomos24.0piecescolour:size:sizebrand:band_2', quantity: 75 },
  { itemCode: '453259', description: 'psmchickencheese&onionsausage250.0gcolour:size:sizebrand:', quantity: 40 },
  { itemCode: '4694', description: 'psmoriginalchickenmomos10.0piecescolour:size:sizebrand:band_4', quantity: 450 },
  { itemCode: '4695', description: 'psmspicychickenmomos10.0piecescolour:size:sizebrand:band_3', quantity: 100 },
  { itemCode: '4697', description: 'psmveg&paneermomos10.0piecescolour:size:sizebrand:band2', quantity: 400 },
  { itemCode: '469735', description: 'meatigoeverydaychickenbreast(frozen)150.0gcolour:size:sizebrand:', quantity: 90 },
  { itemCode: '4698', description: 'psmchickenham200.0gcolour:size:sizebrand:band1', quantity: 150 },
  { itemCode: '4699', description: 'psmporksausage250.0gcolour:size:sizebrand:band_2', quantity: 40 },
  { itemCode: '4700', description: 'psmporkham200.0gcolour:size:sizebrand:band1', quantity: 50 },
  { itemCode: '4701', description: 'psmporkbreakfastbacon300.0gcolour:size:sizebrand:band_1', quantity: 20 },
  { itemCode: '470663', description: 'psmwholewheatmomos-veg&paneer330.0gcolour:size:sizebrand:', quantity: 80 },
  { itemCode: '489632', description: 'psmtandoorimomos-chicken280.0gcolour:size:sizebrand:', quantity: 35 },
  { itemCode: '49168', description: 'psmperiperivegmomos15.0piecescolour:size:sizebrand:band_2', quantity: 80 },
  { itemCode: '498695', description: 'psmchickensalami200.0gcolour:size:sizebrand:', quantity: 25 },
  { itemCode: '26303', description: 'psmchickenpepper&herbsausage250.0gcolour:size:sizebrand:', quantity: 20 },
  { itemCode: '98770', description: 'psmporkbreakfastbacon150.0gcolour:size:sizebrand:', quantity: 36 },
  { itemCode: '6664', description: 'psmchickensausages250.0gcolour:size:sizebrand:band_2', quantity: 380 },
  { itemCode: '6665', description: 'psmchickencheese&chillisausages250.0gcolour:size:sizebrand:band_3', quantity: 100 },
  { itemCode: '730016', description: 'psmwholewheatchickenmomos330.0gcolour:size:sizebrand:', quantity: 80 },
  { itemCode: '750414', description: 'psmsupersaverchickenmomopack(chefmomos)1.0kgcolour:size:sizebrand:', quantity: 72 },
  { itemCode: '755774', description: 'psmchicken&cheesemomos540.0gcolour:size:sizebrand:', quantity: 25 },
  { itemCode: '790919', description: 'meatigoeverydayfishfillet200.0gcolour:size:sizebrand:', quantity: 30 },
  { itemCode: '81521', description: 'psmperiperichickenmomos250.0gcolour:size:sizebrand:band_4', quantity: 640 },
  { itemCode: '89201', description: 'psmchickenenglishbreakfastsausage1.0kgcolour:size:sizebrand:band2', quantity: 162 },
  { itemCode: '205950', description: 'psmfrozenporkpepperonisalami100.0gcolour:size:sizebrand:band_5', quantity: 40 },
  { itemCode: '507809', description: 'psmpizzaminischickentikka180.0gcolour:size:sizebrand:band_6', quantity: 50 },
];

const grnItems = [
  { itemCode: '11423', description: 'psmcheesyspicyvegmomos24.0pieces', receivedQty: 50 },
  { itemCode: '11797', description: 'meatigohotwings250.0g', receivedQty: 75 },
  { itemCode: '18003', description: 'meatigochickencurrycutskinlessfrozen450.0g', receivedQty: 30 },
  { itemCode: '18004', description: 'meatigochickenbonelessbreastfrozen450.0g', receivedQty: 30 },
  { itemCode: '205950', description: 'psmfrozenporkpepperonisalami100.0g', receivedQty: 40 },
  { itemCode: '253430', description: 'psmporksalami200.0g', receivedQty: 75 },
  { itemCode: '33387', description: 'psmfrozenchickenchillisalami200.0g', receivedQty: 75 },
  { itemCode: '33390', description: 'psmchickenseekhkebab500.0g', receivedQty: 272 },
  { itemCode: '398656', description: 'meatigochickendrumsticks450.0g', receivedQty: 270 },
  { itemCode: '414867', description: 'psmchinesevegspringrolls240.0g', receivedQty: 25 },
  { itemCode: '432518', description: 'meatigochickenkheema450.0g', receivedQty: 360 },
  { itemCode: '4459', description: 'psmoriginalchickenmomos24.0pieces', receivedQty: 475 },
  { itemCode: '4460', description: 'psmspicychickenmomos24.0pieces', receivedQty: 325 },
  { itemCode: '4461', description: 'psmveg&paneermomos24.0pieces', receivedQty: 75 },
  { itemCode: '453259', description: 'psmchickencheese&onionsausage250.0g', receivedQty: 40 },
  { itemCode: '4694', description: 'psmoriginalchickenmomos10.0pieces', receivedQty: 450 },
  { itemCode: '4697', description: 'psmveg&paneermomos10.0pieces', receivedQty: 400 },
  { itemCode: '469735', description: 'meatigoeverydaychickenbreast(frozen)150.0g', receivedQty: 90 },
  { itemCode: '4699', description: 'psmporksausage250.0g', receivedQty: 40 },
  { itemCode: '4700', description: 'psmporkham200.0g', receivedQty: 50 },
  { itemCode: '470663', description: 'psmwholewheatmomos-veg&paneer330.0g', receivedQty: 40 },
  { itemCode: '49168', description: 'psmperiperivegmomos15.0pieces', receivedQty: 80 },
  { itemCode: '498695', description: 'psmchickensalami200.0g', receivedQty: 25 },
  { itemCode: '507809', description: 'psmpizzaminischickentikka180.0g', receivedQty: 50 },
  { itemCode: '598770', description: 'psmporkbreakfastbacon150.0g', receivedQty: 36 },
  { itemCode: '6664', description: 'psmchickensausages250.0g', receivedQty: 380 },
  { itemCode: '730016', description: 'psmwholewheatchickenmomos330.0g', receivedQty: 80 },
  { itemCode: '750414', description: 'psmsupersaverchickenmomopack(chefmomos)1.0kg', receivedQty: 72 },
  { itemCode: '755774', description: 'psmchicken&cheesemomos540.0g', receivedQty: 25 },
  { itemCode: '790919', description: 'meatigoeverydayfishfillet200.0g', receivedQty: 30 },
  { itemCode: '81521', description: 'psmperiperichickenmomos250.0g', receivedQty: 640 },
];

const invItems = [
  { itemCode: 'FG-P-F-0503', numericSku: '19022010', description: 'psmcheesyspicyvegetablemomos24pcs', quantity: 50 },
  { itemCode: 'FG-M-F-1703', numericSku: '16023200', description: 'meatigortcmeatigohotwings250g', quantity: 75 },
  { itemCode: 'FG-M-F-0620', numericSku: '02071400', description: 'meatigochickencurrycuts450g(5%)', quantity: 30 },
  { itemCode: 'FG-M-F-0619', numericSku: '02071400', description: 'meatigochickenbonelessbreast450g(5%)', quantity: 30 },
  { itemCode: 'FG-P-F-0249', numericSku: '16010000', description: 'psmporkplainsalami200g', quantity: 75 },
  { itemCode: 'FG-P-F-0234', numericSku: '16010000', description: 'psmfrozenchickenchillisalami200g', quantity: 75 },
  { itemCode: 'FG-P-F-0413', numericSku: '16010000', description: 'psmfrozenchickenseekhkabab500g', quantity: 272 },
  { itemCode: 'FG-M-F-0602', numericSku: '02071400', description: 'meatigochickendrumsticks450g(5%)', quantity: 270 },
  { itemCode: 'FG-P-F-1707', numericSku: '20049000', description: 'psmspringroll-chineseveg240g', quantity: 25 },
  { itemCode: 'FG-M-F-0622', numericSku: '02071400', description: 'meatigochickenkeema(mince)450g(5%)', quantity: 360 },
  { itemCode: 'FG-P-F-0505', numericSku: '19022010', description: 'psmchickenmomos24pcs', quantity: 475 },
  { itemCode: 'FG-P-F-0512', numericSku: '19022010', description: 'psmspicychickenmomos24pcs', quantity: 325 },
  { itemCode: 'FG-P-F-0514', numericSku: '19022010', description: 'psmvegetable&paneermomos24pcs', quantity: 75 },
  { itemCode: 'FG-P-F-0335', numericSku: '16010000', description: 'psmchickencheese&onionsausage250g', quantity: 40 },
  { itemCode: 'FG-P-F-0504', numericSku: '19022010', description: 'psmchickenmomos10pcs', quantity: 450 },
  { itemCode: 'FG-P-F-0513', numericSku: '19022010', description: 'psmvegetable&paneermomos10pcs', quantity: 400 },
  { itemCode: 'FG-M-F-1728', numericSku: '16021000', description: 'meatigortceverydaychickenbreast150g', quantity: 90 },
  { itemCode: 'FG-P-F-0323', numericSku: '16010000', description: 'psmfrozenporksausage250g', quantity: 40 },
  { itemCode: 'FG-P-F-0236', numericSku: '16010000', description: 'psmfrozenporkham200g', quantity: 50 },
  { itemCode: 'FG-P-F-0580', numericSku: '19022010', description: 'psmwholewheatmomos-veg&paneer330g', quantity: 40 },
  { itemCode: 'FG-P-F-0527', numericSku: '19022010', description: 'psmperiperivegmomos15pcs', quantity: 80 },
  { itemCode: 'FG-P-F-0247', numericSku: '16010000', description: 'psmfrozenchickensalami200g', quantity: 25 },
  { itemCode: 'FG-P-F-0102', numericSku: '16010000', description: 'psmfrozenporkbreakfastbacon150g', quantity: 36 },
  { itemCode: 'FG-P-F-0321', numericSku: '16010000', description: 'psmfrozenchickensausage250g', quantity: 380 },
  { itemCode: 'FG-P-F-0581', numericSku: '19022010', description: 'psmwholewheatmomos-chicken330g', quantity: 80 },
  { itemCode: 'FG-P-F-0501', numericSku: '19022010', description: 'psmfschefmomo-chicken1kg', quantity: 72 },
  { itemCode: 'FG-P-F-0564', numericSku: '19022010', description: 'psmcheese&chickenmomos540g', quantity: 25 },
  { itemCode: 'FG-M-F-1729', numericSku: '16042000', description: 'meatigortceverydayfishfillet200g', quantity: 30 },
  { itemCode: 'FG-P-F-0542', numericSku: '19022010', description: 'periperichickenmomos250g', quantity: 640 },
  { itemCode: 'FG-P-F-0237', numericSku: '16010000', description: 'psmfrozenporkpepperonisalami100g', quantity: 40 },
  { itemCode: 'FG-P-F-1911', numericSku: '19059090', description: 'psmpizzaminis-chickentikka180g', quantity: 50 },
];

/* ------------------------------------------------------------------ */
/*  Build PO/GRN/Invoice maps with canonical signatures                 */
/* ------------------------------------------------------------------ */

interface RichItem { qty: number; desc: string; canon: string; }
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

const poMap = buildRichMap(poItems, 'quantity');

/* ------------------------------------------------------------------ */
/*  Resolve with qty tie-breaker                                        */
/* ------------------------------------------------------------------ */

const SIMILARITY_THRESHOLD = 0.65;
const QTY_EXACT_BONUS = 0.15;
const QTY_CLOSE_BONUS = 0.08;

function resolveItemCode(invCode: string, desc: string, numericSku: string, invQty: number, targetMap: RichMap): string | undefined {
  if (targetMap[invCode]) return invCode;
  if (numericSku && targetMap[numericSku]) return numericSku;

  const invCanon = canonicalSignature(desc);
  const exact = Object.keys(targetMap).find((k) => targetMap[k].canon === invCanon);
  if (exact) return exact;

  let bestCode: string | undefined;
  let bestScore = -1;
  let bestDescSim = 0;

  for (const [code, { canon, qty: poQty }] of Object.entries(targetMap)) {
    if (!canon || !invCanon) continue;
    const descSim = similarity(canon, invCanon);
    const qtyDiff = Math.abs(poQty - invQty);
    const qtyBonus = qtyDiff === 0 ? QTY_EXACT_BONUS : qtyDiff <= 10 ? QTY_CLOSE_BONUS : 0;
    const score = descSim + qtyBonus;
    if (score > bestScore) {
      bestScore = score;
      bestCode = code;
      bestDescSim = descSim;
    }
  }

  if (bestCode && bestDescSim >= SIMILARITY_THRESHOLD) return bestCode;
  return undefined;
}

/* Expected mappings */
const expected: Record<string, string> = {
  'FG-P-F-0503': '11423',
  'FG-M-F-1703': '11797',
  'FG-M-F-0620': '18003',
  'FG-M-F-0619': '18004',
  'FG-P-F-0249': '253430',
  'FG-P-F-0234': '33387',
  'FG-P-F-0413': '33390',
  'FG-M-F-0602': '398656',
  'FG-P-F-1707': '414867',
  'FG-M-F-0622': '432518',
  'FG-P-F-0505': '4459',
  'FG-P-F-0512': '4460',
  'FG-P-F-0514': '4461',
  'FG-P-F-0335': '453259',
  'FG-P-F-0504': '4694',
  'FG-P-F-0513': '4697',
  'FG-M-F-1728': '469735',
  'FG-P-F-0323': '4699',
  'FG-P-F-0236': '4700',
  'FG-P-F-0580': '470663',
  'FG-P-F-0527': '49168',
  'FG-P-F-0247': '498695',
  'FG-P-F-0102': '98770',
  'FG-P-F-0321': '6664',
  'FG-P-F-0581': '730016',
  'FG-P-F-0501': '750414',
  'FG-P-F-0564': '755774',
  'FG-M-F-1729': '790919',
  'FG-P-F-0542': '81521',
  'FG-P-F-0237': '205950',
  'FG-P-F-1911': '507809',
};

console.log('=== Invoice → PO resolution ===\n');
let matched = 0, unmatched = 0, wrong = 0;

for (const inv of invItems) {
  const code = resolveItemCode(inv.itemCode, inv.description, inv.numericSku, inv.quantity, poMap);
  const exp = expected[inv.itemCode];
  const isCorrect = code === exp;
  if (code && isCorrect) {
    matched++;
    const sim = similarity(canonicalSignature(inv.description), poMap[code].canon);
    console.log(`✅ ${inv.itemCode} → ${code} (sim=${sim.toFixed(2)})`);
  } else if (code && !isCorrect) {
    wrong++;
    const sim = similarity(canonicalSignature(inv.description), poMap[code].canon);
    console.log(`⚠️  ${inv.itemCode} → ${code} (sim=${sim.toFixed(2)}) EXPECTED ${exp}`);
    console.log(`   INV: "${inv.description}"`);
    console.log(`   GOT:  "${poMap[code].desc}"`);
    if (exp) console.log(`   EXP:  "${poMap[exp].desc}"`);
  } else {
    unmatched++;
    console.log(`❌ ${inv.itemCode} → NO MATCH (expected ${exp})`);
    console.log(`   INV: "${inv.description}"`);
    console.log(`   CANON: "${canonicalSignature(inv.description)}"`);
    if (exp) console.log(`   EXP CANON: "${poMap[exp].canon}"`);
  }
}

console.log(`\n=== Results ===`);
console.log(`Correct:   ${matched}/${invItems.length}`);
console.log(`Wrong:     ${wrong}/${invItems.length}`);
console.log(`Unmatched: ${unmatched}/${invItems.length}`);

/* ------------------------------------------------------------------ */
/*  Build unified rows and show shortfallItems                            */
/* ------------------------------------------------------------------ */

interface UnifiedItem {
  code: string;
  bestDesc: string;
  poQty: number;
  grnQty: number;
  invQty: number;
}

const rows = new Map<string, UnifiedItem>();

// Index PO
for (const item of poItems) {
  const code = item.itemCode?.toString().trim();
  if (!code) continue;
  rows.set(code, {
    code,
    bestDesc: item.description,
    poQty: item.quantity ?? 0,
    grnQty: 0,
    invQty: 0,
  });
}

// Index GRN
for (const item of grnItems) {
  const code = item.itemCode?.toString().trim();
  if (!code) continue;
  if (rows.has(code)) {
    rows.get(code)!.grnQty += item.receivedQty || 0;
  } else {
    rows.set(code, {
      code,
      bestDesc: item.description,
      poQty: 0,
      grnQty: item.receivedQty || 0,
      invQty: 0,
    });
  }
}

// Index Invoice (using the resolution logic)
for (const inv of invItems) {
  const code = resolveItemCode(inv.itemCode, inv.description, inv.numericSku, inv.quantity, poMap);
  if (code && rows.has(code)) {
    rows.get(code)!.invQty += inv.quantity || 0;
  } else {
    rows.set(`INV-${inv.itemCode}`, {
      code: `INV-${inv.itemCode}`,
      bestDesc: inv.description,
      poQty: 0,
      grnQty: 0,
      invQty: inv.quantity || 0,
    });
  }
}

const unified = Array.from(rows.values());

console.log('\n=== Shortfall Items (only actual discrepancies) ===\n');
let shortfallCount = 0;
for (const u of unified) {
  const shortfall = Math.max(0, u.poQty - u.grnQty);
  const hasDiscrepancy =
    shortfall > 0 ||
    u.invQty > u.grnQty ||
    u.grnQty > u.poQty ||
    (u.poQty === 0 && (u.grnQty > 0 || u.invQty > 0));

  if (hasDiscrepancy) {
    shortfallCount++;
    const reasons: string[] = [];
    if (shortfall > 0) reasons.push(`shortReceived=${shortfall}`);
    if (u.invQty > u.grnQty) reasons.push(`overInvoiced=${u.invQty - u.grnQty}`);
    if (u.grnQty > u.poQty) reasons.push(`overReceived=${u.grnQty - u.poQty}`);
    if (u.poQty === 0 && (u.grnQty > 0 || u.invQty > 0)) reasons.push('missingInPO');

    console.log(`${u.code}`);
    console.log(`  PO=${u.poQty}  GRN=${u.grnQty}  INV=${u.invQty}`);
    console.log(`  Reasons: ${reasons.join(', ')}`);
    console.log();
  }
}

console.log(`Total items with discrepancies: ${shortfallCount}/${unified.length}`);

if (wrong === 0 && unmatched === 0) {
  console.log('\n🎉 All invoice items mapped correctly!');
}
