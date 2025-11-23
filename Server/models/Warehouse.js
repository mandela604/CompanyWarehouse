const mongoose = require('mongoose');

const warehouseSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  location: { type: String, required: true },
  address: { type: String }, // Optional: Detailed address
  managerId: { type: String },
  manager: { type: String },
  totalOutlets: { type: Number, default: 0 },
  totalProducts: { type: Number, default: 0 },
  totalShipments: { type: Number, default: 0 },
  totalStock: { type: Number, default: 0 },
  totalRevenue: { type: Number, default: 0 },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  shipmentStatus: { type: String, enum: ['In Transit', 'delivered', 'cancelled', 'Received', 'Rejected'], default: null }, // Status for shipments to outlets
  lastUpdated: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Warehouse', warehouseSchema);