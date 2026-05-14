import mongoose, { Schema, Document } from 'mongoose';

export interface IInvoiceItem {
  itemCode: string;      // SKU key
  description: string;
  quantity: number;      // Invoiced quantity
  unitPrice: number;
  taxableValue: number;
}

export interface IInvoice extends Document {
  invoiceNumber: string; // e.g., "IN25MH2504251"
  poNumber: string;      // Link key
  invoiceDate: Date;
  vendorName: string;
  items: IInvoiceItem[];
  uploadedAt: Date;
}

const InvoiceItemSchema = new Schema<IInvoiceItem>({
  itemCode: { type: String, required: true },
  description: { type: String, required: true },
  quantity: { type: Number, required: true },
  unitPrice: { type: Number, required: true },
  taxableValue: { type: Number, default: 0 },
});

const InvoiceSchema = new Schema<IInvoice>({
  invoiceNumber: { type: String, required: true },
  poNumber: { type: String, required: true, index: true },
  invoiceDate: { type: Date, required: true },
  vendorName: { type: String, required: true },
  items: { type: [InvoiceItemSchema], required: true },
  uploadedAt: { type: Date, default: Date.now },
});

export default mongoose.model<IInvoice>('Invoice', InvoiceSchema);
