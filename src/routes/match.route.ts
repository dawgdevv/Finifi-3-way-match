import { Router, Request, Response, NextFunction } from 'express';
import { runMatch } from '../services/match.service.js';
import MatchResult from '../models/MatchResult.js';

const router = Router();

// Get match result by PO number
router.get('/:poNumber', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { poNumber } = req.params;

    // Re-run match to get latest state
    await runMatch(poNumber);

    const matchResult = await MatchResult.findOne({ poNumber })
      .populate('linkedDocs.poId')
      .populate('linkedDocs.grnIds')
      .populate('linkedDocs.invoiceIds');

    if (!matchResult) {
      res.status(404).json({ error: 'not_found', message: 'No match result found for this PO number' });
      return;
    }

    res.json(matchResult);
  } catch (error) {
    next(error);
  }
});

// Download match report as JSON
router.get('/:poNumber/download', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { poNumber } = req.params;

    await runMatch(poNumber);

    const matchResult = await MatchResult.findOne({ poNumber })
      .populate('linkedDocs.poId')
      .populate('linkedDocs.grnIds')
      .populate('linkedDocs.invoiceIds');

    if (!matchResult) {
      res.status(404).json({ error: 'not_found', message: 'No match result found for this PO number' });
      return;
    }

    const report = {
      reportGeneratedAt: new Date().toISOString(),
      poNumber: matchResult.poNumber,
      status: matchResult.status,
      mismatches: matchResult.mismatches,
      linkedDocuments: matchResult.linkedDocs,
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="match-report-${poNumber}.json"`);
    res.send(JSON.stringify(report, null, 2));
  } catch (error) {
    next(error);
  }
});

export default router;
