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
  po: `Extract the Purchase Order data from this document and return ONLY valid JSON (no markdown, no explanation, no code fences) matching this exact schema:
{
  "poNumber": "string",
  "poDate": "YYYY-MM-DD",
  "vendorName": "string",
  "items": [
    {
      "itemCode": "string",
      "description": "string",
      "quantity": 0,
      "unitPrice": 0,
      "hsnCode": "string"
    }
  ]
}
Ensure itemCode is extracted for every item row. If a row has no visible item code, use the most recent item code from the same section.`,

  grn: `Extract the Goods Receipt Note (GRN) data from this document and return ONLY valid JSON (no markdown, no explanation, no code fences) matching this exact schema:
{
  "grnNumber": "string",
  "poNumber": "string",
  "grnDate": "YYYY-MM-DD",
  "invoiceRef": "string",
  "items": [
    {
      "itemCode": "string",
      "description": "string",
      "expectedQty": 0,
      "receivedQty": 0
    }
  ]
}
If expectedQty is not shown separately, set it equal to receivedQty.`,

  invoice: `Extract the Invoice data from this document and return ONLY valid JSON (no markdown, no explanation, no code fences) matching this exact schema:
{
  "invoiceNumber": "string",
  "poNumber": "string",
  "invoiceDate": "YYYY-MM-DD",
  "vendorName": "string",
  "items": [
    {
      "itemCode": "string",
      "description": "string",
      "quantity": 0,
      "unitPrice": 0,
      "taxableValue": 0
    }
  ]
}
If taxableValue is not shown separately, calculate it as quantity * unitPrice.`,
};

export type DocumentType = 'po' | 'grn' | 'invoice';
