const mongoose = require('mongoose');

const outletSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  warehouseId: { type: String, required: true },
  warehouseName: { type: String, required: true },
  repId: { type: String },
  repName: { type: String },
  repIds: { type: [String], default: [] },
repNames: { type: [String], default: [] },
  location: { type: String, required: true },
  address: { type: String },
  phone: { type: String },
  totalStock: { type: Number, default: 0 },
  totalProducts: { type: Number, default: 0 },
  totalSales: { type: Number, default: 0 },
  revenue: { type: Number, default: 0 },
  managerId: { type: String },
  managerName: { type: String },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  lastUpdated: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Outlet', outletSchema);