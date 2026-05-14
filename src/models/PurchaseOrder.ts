import mongoose, { Schema, Document } from 'mongoose';

export interface IPOItem {
  itemCode: string;      // SKU key (e.g., "11423")
  description: string;
  quantity: number;      // Ordered quantity
  unitPrice: number;
  hsnCode: string;
}

export interface IPurchaseOrder extends Document {
  poNumber: string;      // e.g., "CI4PO05788"
  poDate: Date;
  vendorName: string;
  rawText: string;       // Raw Gemini output (for debugging/auditing)
  items: IPOItem[];
  uploadedAt: Date;
}

const POItemSchema = new Schema<IPOItem>({
  itemCode: { type: String, required: true },
  description: { type: String, required: true },
  quantity: { type: Number, required: true },
  unitPrice: { type: Number, required: true },
  hsnCode: { type: String, default: '' },
});

const PurchaseOrderSchema = new Schema<IPurchaseOrder>({
  poNumber: { type: String, required: true, unique: true, index: true },
  poDate: { type: Date, required: true },
  vendorName: { type: String, required: true },
  rawText: { type: String, default: '' },
  items: { type: [POItemSchema], required: true },
  uploadedAt: { type: Date, default: Date.now },
});

export default mongoose.model<IPurchaseOrder>('PurchaseOrder', PurchaseOrderSchema);
