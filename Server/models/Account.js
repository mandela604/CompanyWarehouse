const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String },
  role: { type: String, required: true, enum: ['admin', 'manager', 'rep'] },
  password: { type: String, required: true },
  manages: [{ type: String }], // IDs of warehouses or outlets managed
  canCreateOutlet: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Account', accountSchema);