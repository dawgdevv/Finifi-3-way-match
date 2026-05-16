import { GoogleGenerativeAI } from '@google/generative-ai';

let _genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!_genAI) {
    const API_KEY = process.env.GEMINI_API_KEY;
    if (!API_KEY) throw new Error('GEMINI_API_KEY is not defined');
    _genAI = new GoogleGenerativeAI(API_KEY);
  }
  return _genAI;
}

export function getGeminiModel() {
  return getGenAI().getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 65536,
    },
  });
}

export const PROMPTS = {
  // PO: minimal fields needed for three-way matching.
  // itemCode is the numeric SKU printed before each description row.
  // unitPrice should be the UNIT BASE COST (the price per unit before tax), NOT the MRP.
  po: `Extract Purchase Order data. Return ONLY valid JSON, no markdown fences, no explanation.

For itemCode: extract the numeric code printed at the start of each row (e.g. "11797", "18003").
If a row has no visible numeric code, use an empty string — do NOT invent one.

CRITICAL: For unitPrice, extract the UNIT BASE COST per item (the actual price per unit, NOT the MRP listed on the document). Look for the "Unit Base Cost" or base price column, not the MRP column.

Schema:
{
  "poNumber": "string",
  "poDate": "YYYY-MM-DD",
  "vendorName": "string",
  "items": [
    {
      "itemCode": "string",
      "sku": "string",
      "description": "string",
      "quantity": 0,
      "unitPrice": 0
    }
  ]
}`,

  // GRN: minimal fields needed for matching.
  // itemCode = numeric SKU, vendorItemCode = vendor SKU (may be same or alphanumeric).
  grn: `Extract GRN data. Return ONLY valid JSON, no markdown fences, no explanation.

This document has two code columns per row:
- "SKU Code" column: numeric code like "11423" → extract as "itemCode"
- "Vendor SKU" column: may be same numeric or alphanumeric → extract as "vendorItemCode"

Extract BOTH codes for every row. Never leave itemCode empty.

Schema:
{
  "grnNumber": "string",
  "poNumber": "string",
  "grnDate": "YYYY-MM-DD",
  "invoiceNumber": "string",
  "vendorName": "string",
  "items": [
    {
      "itemCode": "string",
      "vendorItemCode": "string",
      "vendorSku": "string",
      "description": "string",
      "receivedQty": 0,
      "receivedQuantity": 0,
      "unitPrice": 0
    }
  ]
}

The poNumber is labeled "PO No" on the document.
If receivedQty is absent, use receivedQuantity.`,

  // Invoice: minimal fields needed for matching.
  // itemCode = FG-* code, numericSku = the PRODUCT SKU code if visible (like "11423"), NOT the HSN/SAC tax code.
  invoice: `Extract Invoice data. Return ONLY valid JSON, no markdown fences, no explanation.

For itemCode: use the value in the "Item Code" column — these look like "FG-P-F-0503".
Do NOT use the "Sr. No." column (1, 2, 3...) as itemCode.

For numericSku: extract the PRODUCT SKU code if it appears in the row (looks like "11423", "398656"). 
IMPORTANT: This is NOT the HSN/SAC tax code. If the only numeric code visible is the HSN/SAC code, leave numericSku as empty string.

Schema:
{
  "invoiceNumber": "string",
  "invoiceDate": "YYYY-MM-DD",
  "poNumber": "string",
  "customerOrderNo": "string",
  "vendorName": "string",
  "items": [
    {
      "itemCode": "string",
      "sku": "string",
      "numericSku": "string",
      "description": "string",
      "quantity": 0,
      "rate": 0,
      "unitPrice": 0
    }
  ]
}

The poNumber is in the field labeled "Customer Order No." on this document.
If unitPrice is absent, use rate.`,
};

export type DocumentType = 'po' | 'grn' | 'invoice';