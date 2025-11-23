const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  location: { type: String, required: true },
  address: { type: String },
  adminId: { type: String, required: true },
  adminName: { type: String, required: true },
  totalStock: { type: Number, default: 0 },
  totalProducts: { type: Number, default: 0 },
  totalUnitsSold: { type: Number, default: 0 },
  totalShipments: { type: Number, default: 0 },
  totalWarehouses: { type: Number, default: 0 },
  totalOutlets: { type: Number, default: 0 },
  totalWorkers: { type: Number, default: 0 },
  totalRevenue: { type: Number, default: 0 }, // ✅ Add this
  shipmentStatus: { type: String, enum: ['active', 'inactive'], default: 'active' },
  inTransit: { type: Number, default: 0 },        
  lastUpdated: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Company', companySchema);
