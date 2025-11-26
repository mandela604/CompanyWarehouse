// models/WarehouseInventory.js
const mongoose = require('mongoose');

const warehouseInventorySchema = new mongoose.Schema({
  warehouseId: { type: String, required: true },       
  productId: { type: String, required: true },        
  sku: { type: String, required: true },             
  productName: { type: String, required: true },       
  qty: { type: Number, default: 0 },                  
  unitPrice: { type: Number, default: 0 },           
  inTransit: { type: Number, default: 0 }, 
  totalShipped: { type: Number, default: 0 },         
  totalReceived: { type: Number, default: 0 },       
  revenue: { type: Number, default: 0 },             
  status: { type: String, enum: ['inStock', 'outOfStock'], default: 'inStock' },
  lastUpdated: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

// Compound index for fast lookups
warehouseInventorySchema.index({ warehouseId: 1, productId: 1 }, { unique: true });

module.exports = mongoose.model('WarehouseInventory', warehouseInventorySchema);
