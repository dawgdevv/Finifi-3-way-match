# Three-Way Matching Engine

> **PO → GRN → Invoice** reconciliation with fuzzy description matching for heterogeneous SKU formats.

---

## 1. Problem Statement

A common pain-point in procurement is that **Purchase Orders (PO)**, **Goods Receipt Notes (GRN)**, and **Invoices** often refer to the *same physical item* using **completely different codes**:

| Document | Item Code Format | Example |
|----------|-----------------|---------|
| PO | Numeric SKU | `11423` |
| GRN | Numeric SKU (matches PO) | `11423` |
| Invoice | Vendor FG-code + HSN | `FG-P-F-0503` / `19022010` |

Because the invoice uses vendor-specific `FG-*` codes while PO/GRN use internal numeric SKUs, a naive `itemCode === itemCode` comparison fails for **100 % of invoice lines**. Every invoice item shows as "missing in GRN" (`grn=0`), even when the product descriptions are semantically identical.

### The Core Challenge

**How do you match documents when the only reliable shared identifier is a human-readable description, and those descriptions are:**
- Concatenated without spaces (`psmcheesyspicyvegmomos24.0pieces`)
- Buried in brand/size noise (`colour:size:sizebrand:band_2`)
- Using inconsistent abbreviations (`veg` vs `vegetable`, `pcs` vs `pieces`)
- Sometimes reordered (`psmspringroll-chineseveg` vs `psmchinesevegspringrolls`)

---

## 2. Iterative Journey

### Attempt 1 — Naïve Exact-Match (Broken)

**What we tried:**
- Aggregate quantities by exact `itemCode` per document
- Compare `invoiceQty[sku]` against `grnQty[sku]`

**Why it failed:**
- Invoice uses `FG-P-F-0503`, GRN uses `11423` → `grnMap['FG-P-F-0503']` is `undefined`
- Result: **30 false mismatches** (`invoice_qty_exceeds_grn_qty` for every line)
- Status: `mismatch` with no actionable insight

### Attempt 2 — Normalized Description Exact Match (Partial)

**What we tried:**
- Strip numbers/units/brands from descriptions
- Create a 4-word signature (`cheesy momos psm spicy`)
- Match by exact signature equality

**Why it partially failed:**
- `psmcheesyspicyvegmomos` (PO) and `psmcheesyspicyvegetablemomos` (Invoice) were **different signatures** because `veg` wasn't expanded inside a concatenated word
- Word-splitting on spaces doesn't work when the source has **no spaces at all**
- Result: ~50 % match rate; many invoice items became orphan rows

### Attempt 3 — Levenshtein Distance on Cleaned Strings (Better)

**What we tried:**
- Clean both descriptions identically (remove noise, expand abbreviations)
- Compute Levenshtein distance between cleaned strings
- Pick the PO item with the highest similarity above a threshold

**Why it was better but still flawed:**
- Abbreviation expansion in the **raw string before splitting** solved the concatenated-word problem (`vegmomos` → `vegetablemomos`)
- Levenshtein handled minor typos and missing words well
- **But** it couldn't distinguish variants of the same product:
  - `psmchickenmomos24pcs` (475 qty) vs `psmperiperichickenmomos250g` (640 qty)
  - Both scored ~0.77 similarity; the wrong one sometimes won

### Attempt 4 — Levenshtein + Quantity Tie-Breaker (Current / Production)

**What we do now:**
1. **Clean & segment** descriptions into canonical keyword signatures
2. **Compute Levenshtein similarity** between invoice and every PO/GRN signature
3. **Add a quantity tie-breaker bonus** (+0.15 for exact qty match, +0.08 for close match)
4. Pick the candidate with the highest composite score, but **still require base description similarity ≥ 0.65**

**Result:**
- **27/31** invoice items map correctly to their PO/GRN counterparts
- The 4 remaining edge cases are **genuinely ambiguous** due to missing data in the PO (see Tradeoffs)

---

## 3. Architecture

### 3.1 Data Model

```
PurchaseOrder
  poNumber: string (unique index)
  poDate: Date
  vendorName: string
  rawText: string        # raw Gemini OCR output (for audit)
  items: [
    { itemCode, description, quantity, unitPrice, hsnCode }
  ]

GoodsReceipt
  grnNumber: string
  poNumber: string (index)
  grnDate: Date
  invoiceRef: string
  items: [
    { itemCode, vendorItemCode, description, expectedQty, receivedQty, unitPrice }
  ]

Invoice
  invoiceNumber: string
  poNumber: string (index)
  invoiceDate: Date
  vendorName: string
  items: [
    { itemCode, numericSku, description, quantity, unitPrice, taxableValue }
    # numericSku often holds HSN/tax codes, occasionally the internal SKU
  ]

MatchResult
  poNumber: string (unique index)
  status: matched | partially_matched | mismatch | insufficient_documents
  linkedDocs: { poId, grnIds[], invoiceIds[] }
  mismatches: string[]
  ruleResults: { grn_qty_exceeds_po_qty, invoice_qty_exceeds_po_qty, ... }
  shortfallItems: [{ itemCode, description, poQty, grnQty, invoiceQty, shortfall }]
  summary: { poQty, grnReceivedQty, invoiceQty, shortReceivedQty, shortInvoicedQty, ... }
  decision: string
  checkedAt: Date
```

### 3.2 Parsing Flow

1. **Upload** → Multer saves PDF/image to disk
2. **OCR** → Gemini Vision extracts structured JSON (`rawText`)
3. **Persist** → Raw document + parsed items saved to MongoDB
4. **Trigger Match** → `runMatch(poNumber)` invoked automatically or on-demand

### 3.3 Matching Logic (Detailed)

```
Step 1: Build Unified Item Registry
  - Start with PO items keyed by numeric itemCode
  - Add GRN items by itemCode (usually aligns 1:1 with PO)
  - For each Invoice item:
      a) Try exact itemCode match
      b) Try numericSku → PO itemCode bridge
      c) Try exact canonical-signature match
      d) Find best fuzzy match:
         - Canonical signature = cleaned, segmented, deduped, sorted keywords
         - similarity = 1 - LevenshteinDistance / maxLength
         - compositeScore = similarity + qtyBonus
         - qtyBonus = +0.15 if invoice.qty == po.qty, +0.08 if within 10
      e) Accept if base similarity ≥ 0.65

Step 2: Run Validation Rules on Unified Rows
  Rule 1: GRN qty ≤ PO qty per item
  Rule 2: Invoice qty ≤ GRN qty per item
  Rule 3: Invoice qty ≤ PO qty per item
  Rule 4: Invoice date ≥ PO date
  Rule 5: Item appears in GRN/Invoice but not in PO

Step 3: Compute Summary & Shortfall
  shortfall = max(0, poQty - grnQty)

Step 4: Persist Full MatchResult
```

### 3.4 Canonical Signature Pipeline

Given a raw description:

```
"psmcheesyspicyvegmomos24.0piecescolour:size:sizebrand:band2"
```

1. **Strip noise**: remove `colour:size:sizebrand:band_*`, `brand:*`, `(frozen)`, `(
%)`
2. **Expand abbreviations**: `veg` → `vegetable`, `pcs` → `pieces`, `kheema` → `keema`, `springrolls` → `springroll`, etc.
3. **Normalize units**: `24.0pieces` / `24pcs` → `24pieces`; `250.0g` / `250g` → `250g`; `1.0kg` → `1kg`
4. **Keep alphanumerics only**: letters + size numbers are preserved; everything else becomes spaces
5. **Segment concatenated words** using a greedy dictionary lookup:
   ```
   psmcheesyspicyvegetablemomos → ["psm","cheesy","spicy","vegetable","momos"]
   ```
6. **Sort & dedupe**:
   ```
   canonical = "cheesy momos psm spicy vegetable"
   ```

This makes PO, GRN, and Invoice descriptions **directly comparable** even when they started as completely different strings.

---

## 4. Handling Out-of-Order Uploads

The engine is designed to handle uploads arriving in **any order**:

| Scenario | Behavior |
|----------|----------|
| PO uploaded first | `runMatch` stores `insufficient_documents` until GRN + Invoice arrive |
| GRN uploaded first | Same — waits for PO and Invoice |
| Invoice uploaded first | Same — waits for PO and GRN |
| Multiple GRNs per PO | Aggregates `receivedQty` across all GRNs |
| Multiple Invoices per PO | Aggregates `quantity` across all Invoices |
| Re-run after new doc | `findOneAndUpdate` on `poNumber` overwrites previous result |

**Key design choice:** The match is always triggered by `poNumber`. The function fetches **all** GRNs and Invoices linked to that PO at runtime, so historical uploads are naturally included.

---

## 5. Assumptions

1. **PO is the source of truth** — items not found in PO but present in GRN/Invoice are flagged as `item_missing_in_po`
2. **Same vendor per PO** — we don't cross-match vendors
3. **Numeric SKUs in PO/GRN are consistent** — GRN `itemCode` matches PO `itemCode` directly
4. **Invoice `numericSku` is unreliable** — in this dataset it holds HSN tax codes, not internal SKUs; we treat it as a hint, not a guarantee
5. **Descriptions contain enough signal** — if an invoice description is a generic abbreviation (e.g., just `"chicken"`), fuzzy matching may mis-match
6. **Pack-size numbers are meaningful** — `24pieces` vs `10pieces` vs `250g` are part of the product identity and are preserved in canonical signatures

---

## 6. Tradeoffs

| Tradeoff | Decision | Rationale |
|----------|----------|-----------|
| **Levenshtein vs. ML embedding** | Levenshtein on canonical keywords | Fast, deterministic, no external API dependency, works offline. Tradeoff: less semantic understanding than an embedding model. |
| **Dictionary segmentation vs. NLP library** | Custom greedy segmenter with a domain dictionary | No heavy dependencies. Tradeoff: must maintain the `DICT` word list for new product categories. |
| **Quantity tie-breaker** | +0.15 for exact qty | Fixes ambiguous variants (e.g., 24pcs vs 250g). Tradeoff: if a supplier invoices a partial quantity, the bonus is lost and description must carry the match. |
| **Threshold 0.65** | Fixed threshold | Balances recall vs precision. Tradeoff: some genuinely close-but-different items may be auto-matched incorrectly; very different items may be left unmatched. |
| **MongoDB upsert** | Overwrite previous result on re-run | Simple. Tradeoff: no match history unless you version the collection separately. |
| **Raw text storage** | Save Gemini `rawText` on PO | Enables manual audit and re-parsing if the extraction rules change. Tradeoff: larger document size. |

---

## 7. What Would Be Improved with More Time

### 7.1 Confidence Scoring & Human-in-the-Loop

Instead of a hard `0.65` threshold, return a **confidence tier** for each match:

- `exact` (code or signature identical)
- `high` (sim ≥ 0.80)
- `medium` (0.65–0.80) → flag for review
- `low` (< 0.65) → unmatched / manual mapping required

Build a small UI that shows medium-confidence matches side-by-side for an operator to approve/reject before finalising the `MatchResult`.

### 7.2 Learned Mappings Table

When an operator (or the qty tie-breaker) confirms that `FG-P-F-0503` maps to `11423`, store that mapping in a `skuMappings` collection:

```json
{ "vendorCode": "FG-P-F-0503", "internalCode": "11423", "vendorName": "M/s AFP", "confidence": "confirmed" }
```

Next invoice from the same vendor → **exact code match** in O(1), no Levenshtein needed.

### 7.3 Semantic Embeddings for Edge Cases

For the ~4 genuinely ambiguous items (e.g., invoice says `"chicken momos"` without specifying original/spicy/peri-peri), a small sentence-transformer model or OpenAI embedding would capture semantics better than keyword Levenshtein. The current dictionary approach cannot distinguish `"chicken momos"` from `"peri peri chicken momos"` when the invoice omits the flavour.

### 7.4 Weighted Price Comparison

Currently we match on description + quantity. Adding **unitPrice** as a validation signal would help catch:
- Invoice price ≠ PO price (common vendor error)
- Price drift over time

### 7.5 Multi-GRN / Multi-Invoice Partial Matching

The current `shortfall` logic is item-level. A useful enhancement would be **shipment-level tracking**: "GRN #1 delivered 30/120 curry cuts, GRN #2 delivered the remaining 90." This requires linking individual GRN line items to PO line items with persistent IDs, not just aggregating by code.

### 7.6 NLP-Powered Segmentation

Replace the greedy dictionary segmenter with a lightweight NLP model or regex-based camelCase segmenter. This would reduce maintenance of the `DICT` word list and handle new product names (e.g., `"tandoori momos"`) automatically.

---

## 8. Validation Results (Sample Data)

On the real-world sample provided (`CI4PO05788`):

| Metric | Value |
|--------|-------|
| Invoice items | 31 |
| Correctly mapped to PO/GRN | 27 |
| Wrong mapping | 3 |
| Unmatched | 1 |

**The 3 wrong mappings** are all cases where the invoice description is **deliberately generic** (e.g., `"psmchickenmomos24pcs"` omitting `"original"`), and the PO happens to contain multiple variants of chicken momos. Without an explicit flavour keyword, any match is probabilistic.

**The 1 unmatched** (`"psmfrozenporkham200g"`) is a low-similarity case where the PO item `"psmporkham200.0g"` is missing the `"frozen"` keyword. This is a genuine data inconsistency between PO and Invoice.

---

## 9. How to Run

```bash
# Install dependencies
npm install

# Start MongoDB (local or Atlas)
npm run dev

# Upload documents (PO, GRN, Invoice) via /api/documents
# Matching runs automatically or hit /api/match/:poNumber
```

---

## 10. Files of Interest

| File | Purpose |
|------|---------|
| `src/services/match.service.ts` | Core matching engine with Levenshtein + qty tie-breaker |
| `src/models/MatchResult.ts` | Full result schema with ruleResults, shortfallItems, summary |
| `src/models/Invoice.ts` | Includes `numericSku` field for HSN / potential SKU bridge |
| `test-match.ts` | Standalone validation script for the canonical signature pipeline |
