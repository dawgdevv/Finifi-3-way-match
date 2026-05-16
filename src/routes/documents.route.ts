import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
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

      const parsed = await parseDocument(req.file.buffer, req.file.mimetype, documentType);

      let savedDoc: any;

      if (documentType === 'po') {
        // PO: strict uniqueness — one PO per poNumber
        const existing = await PurchaseOrder.findOne({ poNumber: parsed.poNumber });
        if (existing) {
          res.status(409).json({
            error: 'duplicate_po',
            poNumber: parsed.poNumber,
            message: 'A Purchase Order with this number already exists. Delete it first to re-upload.',
          });
          return;
        }
        savedDoc = await PurchaseOrder.create({ ...parsed, rawText: JSON.stringify(parsed) });

      } else if (documentType === 'grn') {
        // GRN: deduplicate by grnNumber — replace existing if re-uploaded
        const existing = await GoodsReceipt.findOne({ grnNumber: parsed.grnNumber });
        if (existing) {
          // Update in place rather than creating a duplicate
          savedDoc = await GoodsReceipt.findByIdAndUpdate(
            existing._id,
            { ...parsed, uploadedAt: new Date() },
            { new: true }
          );
        } else {
          savedDoc = await GoodsReceipt.create(parsed);
        }

      } else {
        // Invoice: deduplicate by invoiceNumber — replace existing if re-uploaded
        const existing = await Invoice.findOne({ invoiceNumber: parsed.invoiceNumber });
        if (existing) {
          savedDoc = await Invoice.findByIdAndUpdate(
            existing._id,
            { ...parsed, uploadedAt: new Date() },
            { new: true }
          );
        } else {
          savedDoc = await Invoice.create(parsed);
        }
      }

      await runMatch(parsed.poNumber);
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