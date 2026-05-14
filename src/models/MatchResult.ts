import mongoose, { Schema, Document, Types } from 'mongoose';

export type MatchStatus = 'matched' | 'partially_matched' | 'mismatch' | 'insufficient_documents';

export interface IMatchResult extends Document {
  poNumber: string;      // Unique — one match result per PO
  status: MatchStatus;
  linkedDocs: {
    poId: Types.ObjectId;
    grnIds: Types.ObjectId[];
    invoiceIds: Types.ObjectId[];
  };
  mismatches: string[];  // Human-readable mismatch reasons
  checkedAt: Date;
}

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
  checkedAt: { type: Date, default: Date.now },
});

export default mongoose.model<IMatchResult>('MatchResult', MatchResultSchema);
