// models/Sale.js
const mongoose = require('mongoose');

const saleSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  outletId: { type: String, required: true },
  productId: { type: String, required: true },
  qtySold: { type: Number, required: true },
  totalAmount: { type: Number, required: true },
  transactionId: {
  type: String,
  required: true,
  index: true  // very important for performance
},
  soldBy: { type: String, required: true }, 
  isReversal: { type: Boolean, default: false },
reversedSaleId: { type: String },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Sale', saleSchema);
