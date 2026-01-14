const mongoose = require('mongoose');

const restockLogSchema = new mongoose.Schema({
  productId:    { type: String, required: true, index: true },
  productName:  { type: String, required: true },
  addedQty:     { type: Number, required: true, min: 1 },
  restockedBy:  { type: String, required: true },     // user's full name
  restockedById:{ type: String },                     // user's ID (optional but useful)
  date:         { type: Date, default: Date.now, index: true },
  notes:        { type: String, default: '' }         // optional future field
}, { timestamps: true });

module.exports = mongoose.model('RestockLog', restockLogSchema);