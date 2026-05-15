import { GoogleGenerativeAI } from '@google/generative-ai';

let _genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!_genAI) {
    const API_KEY = process.env.GEMINI_API_KEY;
    if (!API_KEY) {
      throw new Error('GEMINI_API_KEY is not defined in environment variables');
    }
    _genAI = new GoogleGenerativeAI(API_KEY);
  }
  return _genAI;
}

export function getGeminiModel() {
  return getGenAI().getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 8192,
    },
  });
}

export const PROMPTS = {
  po: `Extract Purchase Order data. Return ONLY valid JSON, no markdown fences.

IMPORTANT for itemCode: 
- Most rows have a numeric item code printed before the description (e.g. "11797", "18003", "432518")
- Some rows have NO item code. For those, generate a fallback using the first 3 words of description + quantity, like "desc:Chicken Drumsticks:270"
- Never leave itemCode empty

Schema:
{
  "poNumber": "string",
  "poDate": "YYYY-MM-DD",
  "vendorName": "string",
  "items": [{
    "itemCode": "string",
    "description": "string",
    "quantity": 0,
    "unitPrice": 0,
    "hsnCode": "string"
  }]
}`,

  grn: `Extract GRN data. Return ONLY valid JSON, no markdown fences.

CRITICAL: Each item has TWO codes — extract BOTH:
1. "itemCode": the numeric SKU code in the "SKU Code" column (e.g. "11423", "398656")
2. "vendorItemCode": the vendor's alphanumeric code if shown (e.g. "FG-P-F-0503")

Schema:
{
  "grnNumber": "string",
  "poNumber": "string", 
  "grnDate": "YYYY-MM-DD",
  "invoiceRef": "string",
  "items": [{
    "itemCode": "string",
    "vendorItemCode": "string",
    "description": "string",
    "expectedQty": 0,
    "receivedQty": 0
  }]
}

If expectedQty column is absent, set it equal to receivedQty.
The poNumber field is labeled "PO No" on the document.`,

  invoice: `Extract Invoice data. Return ONLY valid JSON, no markdown fences.

The "Item Code" column contains codes like "FG-P-F-0503" or "FG-M-F-1703".
The "Sr. No." column is just a row number — do NOT use it as itemCode.

Schema:
{
  "invoiceNumber": "string",
  "poNumber": "string",
  "invoiceDate": "YYYY-MM-DD",
  "vendorName": "string",
  "items": [{
    "itemCode": "string",
    "description": "string",
    "quantity": 0,
    "unitPrice": 0,
    "taxableValue": 0
  }]
}

The poNumber is in the field labeled "Customer Order No." on this document.
If taxableValue is absent, calculate as quantity * unitPrice.`,
};

export type DocumentType = 'po' | 'grn' | 'invoice';
