import mongoose, { Schema } from 'mongoose';
import type { Document } from 'mongoose';

export interface IGRNItem {
  itemCode: string;          // Numeric SKU code from GRN (e.g., "11423")
  vendorItemCode: string;    // Vendor's alphanumeric / vendorSku code
  description: string;
  expectedQty?: number;      // From PO (optional — not needed for matching)
  receivedQty: number;       // Actual received
  unitPrice: number;          // Unit price per item
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
  expectedQty: { type: Number, default: 0 },
  receivedQty: { type: Number, required: true },
  unitPrice: { type: Number, default: 0 },
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
