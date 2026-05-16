import mongoose, { Schema } from 'mongoose';
import type { Document, Types } from 'mongoose';

export type MatchStatus = 'matched' | 'partially_matched' | 'mismatch' | 'insufficient_documents';

export interface IShortfallItem {
  itemCode: string;
  description: string;
  poQty: number;
  grnQty: number;
  invoiceQty: number;
  shortfall: number;
}

export interface IMatchResult extends Document {
  poNumber: string;
  status: MatchStatus;
  linkedDocs: {
    poId: Types.ObjectId;
    grnIds: Types.ObjectId[];
    invoiceIds: Types.ObjectId[];
  };
  mismatches: string[];
  summary: {
    poQty: number;
    grnReceivedQty: number;
    invoiceQty: number;
    shortReceivedQty: number;
    shortInvoicedQty: number;
    poDate: string;
    grnDate: string | null;
    invoiceDate: string | null;
    invoiceNumber: string | null;
  };
  reasons: string[];
  ruleResults: {
    grn_qty_exceeds_po_qty: boolean;
    invoice_qty_exceeds_po_qty: boolean;
    invoice_qty_exceeds_grn_qty: boolean;
    invoice_date_before_po_date: boolean;
    duplicate_po: boolean;
    item_missing_in_po: boolean;
  };
  decision: string;
  shortfallItems: IShortfallItem[];
  checkedAt: Date;
}

const ShortfallItemSchema = new Schema<IShortfallItem>({
  itemCode: { type: String, required: true },
  description: { type: String, required: true },
  poQty: { type: Number, required: true },
  grnQty: { type: Number, required: true },
  invoiceQty: { type: Number, required: true },
  shortfall: { type: Number, required: true },
}, { _id: false });

const MatchResultSchema = new Schema<IMatchResult>({
  poNumber: { type: String, required: true, unique: true, index: true },
  status: {
    type: String,
    required: true,
    enum: ['matched', 'partially_matched', 'mismatch', 'insufficient_documents'],
    default: 'insufficient_documents',
  },
  linkedDocs: {
    poId: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true },
    grnIds: [{ type: Schema.Types.ObjectId, ref: 'GoodsReceipt', default: [] }],
    invoiceIds: [{ type: Schema.Types.ObjectId, ref: 'Invoice', default: [] }],
  },
  mismatches: { type: [String], default: [] },
  summary: {
    poQty: { type: Number, default: 0 },
    grnReceivedQty: { type: Number, default: 0 },
    invoiceQty: { type: Number, default: 0 },
    shortReceivedQty: { type: Number, default: 0 },
    shortInvoicedQty: { type: Number, default: 0 },
    poDate: { type: String, default: '' },
    grnDate: { type: String, default: null },
    invoiceDate: { type: String, default: null },
    invoiceNumber: { type: String, default: null },
  },
  reasons: { type: [String], default: [] },
  ruleResults: {
    grn_qty_exceeds_po_qty: { type: Boolean, default: false },
    invoice_qty_exceeds_po_qty: { type: Boolean, default: false },
    invoice_qty_exceeds_grn_qty: { type: Boolean, default: false },
    invoice_date_before_po_date: { type: Boolean, default: false },
    duplicate_po: { type: Boolean, default: false },
    item_missing_in_po: { type: Boolean, default: false },
  },
  decision: { type: String, default: '' },
  shortfallItems: { type: [ShortfallItemSchema], default: [] },
  checkedAt: { type: Date, default: Date.now },
});

export default mongoose.model<IMatchResult>('MatchResult', MatchResultSchema);
