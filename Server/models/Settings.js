const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, default: 'system-settings' },
  lowStockThreshold: { 
    type: Number, 
    required: true, 
    default: 50, 
    min: [0, 'Low stock threshold cannot be negative'] 
  },
  managerPermissions: {
    canCreateOutlet: { type: Boolean, default: false },
    canCreateUser: { type: Boolean, default: false },
    canAssignRepRole: { type: Boolean, default: false }
  },
  config: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  },
  lastUpdated: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

settingsSchema.index({ id: 1 }, { unique: true });

settingsSchema.pre('save', function(next) {
  this.lastUpdated = Date.now();
  next();
});

module.exports = mongoose.model('Settings', settingsSchema);