import mongoose, { Schema } from 'mongoose';
import type { Document } from 'mongoose';

export interface IInvoiceItem {
  itemCode: string;      // Vendor FG-* code, e.g. "FG-P-F-0503"
  numericSku: string;    // Numeric SKU if found in the row, e.g. "11423" (may be empty)
  description: string;
  quantity: number;
  unitPrice: number;
  taxableValue: number;
}

export interface IInvoice extends Document {
  invoiceNumber: string;
  poNumber: string;
  invoiceDate: Date;
  vendorName: string;
  items: IInvoiceItem[];
  uploadedAt: Date;
}

const InvoiceItemSchema = new Schema<IInvoiceItem>({
  itemCode:     { type: String, required: true },
  numericSku:   { type: String, default: '' },
  description:  { type: String, required: true },
  quantity:     { type: Number, required: true },
  unitPrice:    { type: Number, required: true },
  taxableValue: { type: Number, default: 0 },
});

const InvoiceSchema = new Schema<IInvoice>({
  invoiceNumber: { type: String, required: true },
  poNumber:      { type: String, required: true, index: true },
  invoiceDate:   { type: Date, required: true },
  vendorName:    { type: String, required: true },
  items:         { type: [InvoiceItemSchema], required: true },
  uploadedAt:    { type: Date, default: Date.now },
});

export default mongoose.model<IInvoice>('Invoice', InvoiceSchema);