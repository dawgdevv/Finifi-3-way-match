import { getGeminiModel, PROMPTS } from '../config/gemini.js';
import type { DocumentType } from '../config/gemini.js';

export async function parseDocument(
  fileBuffer: Buffer,
  mimeType: string,
  docType: DocumentType
): Promise<any> {
  const prompt = PROMPTS[docType];

  try {
    const result = await getGeminiModel().generateContent([
      {
        inlineData: {
          data: fileBuffer.toString('base64'),
          mimeType,
        },
      },
      prompt,
    ]);

    const text = result.response.text().trim();

    // Strip markdown fences if Gemini adds them
    const clean = text
      .replace(/^```json\n?/i, '')
      .replace(/^```\n?/i, '')
      .replace(/\n?```$/, '');

    const parsed = JSON.parse(clean);

    // Normalize poNumber — it appears under different labels across docs
    if (!parsed.poNumber && parsed.customerOrderNo) {
      parsed.poNumber = parsed.customerOrderNo;
    }

    // Strip leading/trailing whitespace from all string fields at top level
    for (const key of Object.keys(parsed)) {
      if (typeof parsed[key] === 'string') {
        parsed[key] = parsed[key].trim();
      }
    }

    // Normalize date to ISO string immediately after parsing
    const dateFields = ['poDate', 'grnDate', 'invoiceDate'];
    for (const field of dateFields) {
      if (parsed[field]) {
        const d = new Date(parsed[field]);
        if (!isNaN(d.getTime())) {
          parsed[field] = d.toISOString().split('T')[0];
        }
      }
    }

    // Normalize items
    if (parsed.items && Array.isArray(parsed.items)) {
      for (const item of parsed.items) {
        // Normalize sku -> itemCode
        if (!item.itemCode && item.sku) {
          item.itemCode = item.sku;
        }
        // Normalize vendorSku -> vendorItemCode
        if (!item.vendorItemCode && item.vendorSku) {
          item.vendorItemCode = item.vendorSku;
        }
        // Normalize receivedQuantity -> receivedQty
        if (item.receivedQty === undefined && item.receivedQuantity !== undefined) {
          item.receivedQty = item.receivedQuantity;
        }
        // Normalize expectedQuantity -> expectedQty
        if (item.expectedQty === undefined && item.expectedQuantity !== undefined) {
          item.expectedQty = item.expectedQuantity;
        }
        // Default expectedQty to receivedQty if still missing (GRN often omits expected)
        if (item.expectedQty === undefined && item.receivedQty !== undefined) {
          item.expectedQty = item.receivedQty;
        }
        // Normalize rate -> unitPrice (invoice often uses "rate")
        if (item.unitPrice === undefined && item.rate !== undefined) {
          item.unitPrice = item.rate;
        }
        // Normalize description: lowercase and strip all spaces for uniform matching
        if (typeof item.description === 'string') {
          item.description = item.description
            .toLowerCase()
            .replace(/\s+/g, '');
        }
      }

      // Only drop items if both itemCode and description are missing
      parsed.items = parsed.items.filter((item: any) => {
        const hasCode = item.itemCode && item.itemCode.toString().trim() !== '';
        const hasDesc = item.description && item.description.toString().trim() !== '';
        if (!hasCode && !hasDesc) {
          console.warn(`Skipping item without itemCode and description in ${docType}:`, item);
          return false;
        }
        return true;
      });
    }

    return parsed;
  } catch (error: any) {
    console.error('Gemini parsing error:', error);
    const err = new Error(`Failed to parse ${docType}: ${error.message}`);
    (err as any).status = 422;
    throw err;
  }
}
