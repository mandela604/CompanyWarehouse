const mongoose = require('mongoose');

const shipmentSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  date: { type: Date, required: true, default: Date.now },
  products: [
    {
      productId: { type: String, required: true },
      productSku: { type: String, required: true },
          name: { type: String, required: true },   
      qty: { type: Number, required: true, default: 0 },
      unitPrice: { type: Number, required: true, default: 0 }
    }
  ],
  from: {
  id: { type: String, required: true },   
  name: { type: String, required: true },  
},
  to: {
  id: { type: String, required: true },    
  name: { type: String, required: true },   
},
  fromType: { type: String, enum: ['Company', 'Warehouse'], required: true },
  toType: { type: String, enum: ['Warehouse', 'Outlet'], required: true },
  status: { type: String, enum: ['In Transit', 'delivered', 'cancelled', 'Received', 'Rejected'], required: true },
  senderId: { type: String },
  senderPhone: { type: String },
  sentFrom: { type: String, required: true, default: 'Company' },
    receiverId: { type: String },     // Fixed: added type
  receiverName: { type: String },
  lastUpdated: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Shipment', shipmentSchema);