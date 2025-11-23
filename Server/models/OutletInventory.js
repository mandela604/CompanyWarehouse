// models/OutletInventory.js
const mongoose = require('mongoose');

const outletInventorySchema = new mongoose.Schema({
  outletId: { type: String, required: true },      
  productId: { type: String, required: true },     
  sku: { type: String, required: true },           
  productName: { type: String, required: true },   
  qty: { type: Number, default: 0 },                
  price: { type: Number, default: 0 },             
  totalReceived: { type: Number, default: 0 },      
  totalSold: { type: Number, default: 0 },          
  revenue: { type: Number, default: 0 },          
  warehouseId:  { type: String, required: true },
  status: { type: String, enum: ['inStock', 'outOfStock'], default: 'inStock' },
  lastUpdated: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

// Compound index to ensure one product per outlet is unique
outletInventorySchema.index({ outletId: 1, productId: 1 }, { unique: true });

module.exports = mongoose.model('OutletInventory', outletInventorySchema);
