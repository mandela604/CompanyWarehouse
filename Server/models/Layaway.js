const mongoose = require('mongoose');

const layawaySchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  outletId: { type: String, required: true },
  repId: { type: String, required: true },
  repName: String,
  customerName: { type: String, default: 'Walk-in' },
  items: [{
    productId: String,
    productName: String,
    sku: String,
    qtyRequested: Number,
    unitPrice: Number
  }],
  totalAmount: Number,
  paidAmount: Number,
  balance: Number,
  status: {
    type: String,
    enum: ['pending_payment', 'full_paid_pending_pickup', 'completed', 'cancelled'],
    default: 'pending_payment'
  },
  payments: [{
    amount: Number,
    date: Date,
    recordedBy: String,
    method: { type: String, default: 'cash' }
  }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: Date
});

module.exports = mongoose.model('Layaway', layawaySchema);