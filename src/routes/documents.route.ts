import { Router, Request, Response, NextFunction } from 'express';
import { upload } from '../middleware/upload.middleware.js';
import { parseDocument } from '../services/parser.service.js';
import { runMatch } from '../services/match.service.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import GoodsReceipt from '../models/GoodReceipt.js';
import Invoice from '../models/Invoice.js';
import MatchResult from '../models/MatchResult.js';

const router = Router();

router.post(
  '/upload',
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { documentType } = req.body as { documentType: 'po' | 'grn' | 'invoice' };

      if (!documentType || !['po', 'grn', 'invoice'].includes(documentType)) {
        res.status(400).json({ error: 'invalid_document_type', message: 'documentType must be po, grn, or invoice' });
        return;
      }

      if (!req.file) {
        res.status(400).json({ error: 'missing_file', message: 'No PDF file uploaded' });
        return;
      }

      // 1. Parse with Gemini
      const parsed = await parseDocument(req.file.buffer, req.file.mimetype, documentType);

      // 2. Save to appropriate collection
      let savedDoc: any;
      if (documentType === 'po') {
        const existing = await PurchaseOrder.findOne({ poNumber: parsed.poNumber });
        if (existing) {
          res.status(409).json({ error: 'duplicate_po', poNumber: parsed.poNumber, message: 'Purchase Order already exists' });
          return;
        }
        savedDoc = await PurchaseOrder.create({ ...parsed, rawText: JSON.stringify(parsed) });
      } else if (documentType === 'grn') {
        savedDoc = await GoodsReceipt.create(parsed);
      } else {
        savedDoc = await Invoice.create(parsed);
      }

      // 3. Trigger matching
      await runMatch(parsed.poNumber);

      // 4. Return saved doc + match state
      const matchResult = await MatchResult.findOne({ poNumber: parsed.poNumber });

      res.status(201).json({
        success: true,
        document: savedDoc,
        matchState: matchResult,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get any document by ID and collection type
router.get('/:collection/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { collection, id } = req.params;
    let doc: any;

    if (collection === 'po') {
      doc = await PurchaseOrder.findById(id);
    } else if (collection === 'grn') {
      doc = await GoodsReceipt.findById(id);
    } else if (collection === 'invoice') {
      doc = await Invoice.findById(id);
    } else {
      res.status(400).json({ error: 'invalid_collection', message: 'Collection must be po, grn, or invoice' });
      return;
    }

    if (!doc) {
      res.status(404).json({ error: 'not_found', message: 'Document not found' });
      return;
    }

    res.json(doc);
  } catch (error) {
    next(error);
  }
});

export default router;
