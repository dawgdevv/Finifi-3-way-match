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

    // Validate item codes are present
    if (parsed.items && Array.isArray(parsed.items)) {
      parsed.items = parsed.items.filter((item: any) => {
        if (!item.itemCode || item.itemCode.trim() === '') {
          console.warn(`Skipping item without itemCode in ${docType}:`, item);
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
