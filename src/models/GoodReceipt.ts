import mongoose, { Schema } from 'mongoose';
import type { Document } from 'mongoose';

export interface IGRNItem {
  itemCode: string;          // Numeric SKU code from GRN (e.g., "11423")
  vendorItemCode: string;    // Vendor's alphanumeric code (e.g., "FG-P-F-0503")
  description: string;
  expectedQty: number;       // From PO
  receivedQty: number;       // Actual received
}

export interface IGoodsReceipt extends Document {
  grnNumber: string;     // e.g., "CI4000020234"
  poNumber: string;      // Link key (not unique — multiple GRNs per PO allowed)
  grnDate: Date;
  invoiceRef: string;    // Reference invoice number if mentioned
  items: IGRNItem[];
  uploadedAt: Date;
}

const GRNItemSchema = new Schema<IGRNItem>({
  itemCode: { type: String, required: true },
  vendorItemCode: { type: String, default: '' },
  description: { type: String, required: true },
  expectedQty: { type: Number, required: true },
  receivedQty: { type: Number, required: true },
});

const GoodsReceiptSchema = new Schema<IGoodsReceipt>({
  grnNumber: { type: String, required: true },
  poNumber: { type: String, required: true, index: true },
  grnDate: { type: Date, required: true },
  invoiceRef: { type: String, default: '' },
  items: { type: [GRNItemSchema], required: true },
  uploadedAt: { type: Date, default: Date.now },
});

export default mongoose.model<IGoodsReceipt>('GoodsReceipt', GoodsReceiptSchema);
