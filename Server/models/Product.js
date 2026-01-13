const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  sku: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  qty: { type: Number, required: true, default: 0 },
  companyId: { type: String, required: true }, // Links to Company (HQ)
  companyName: { type: String, required: true }, // Name of the Company (HQ)
  unitPrice: { type: Number, required: true, default: 0 },
  totalSales: { type: Number, default: 0 },
  status: { type: String, enum: ['inStock', 'outOfStock'], default: 'inStock' },
  lastUpdated: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

productSchema.pre('save', function(next) {
  this.lastUpdated = Date.now();  
  next();
});


module.exports = mongoose.model('Product', productSchema);