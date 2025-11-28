const express = require('express');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const { ensureAuth, ensureManager } = require('../middlewares/auth');
const Shipment = require('../models/Shipment');
const Warehouse = require('../models/Warehouse');
const Outlet = require('../models/Outlet');
const Company = require('../models/Company');
const Product = require('../models/Product');
const WarehouseInventory = require('../models/WarehouseInventory');
const OutletInventory = require('../models/OutletInventory');

const router = express.Router();

// CREATE SHIPMENT
router.post('/shipments', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { fromId, toId, fromType, toType, products, senderId, senderPhone } = req.body;

    if (!fromId || !toId || !fromType || !toType || !products?.length) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // 🔹 Fetch dynamic names safely
    let fromName, toName;
    if (fromType === 'Company') {
      const company = await Company.findOne({ id: fromId }).session(session);
      if (!company) throw new Error('Company not found');
      fromName = company.name;
    } else if (fromType === 'Warehouse') {
      const warehouse = await Warehouse.findOne({ id: fromId }).session(session);
      if (!warehouse) throw new Error('Warehouse not found');
      fromName = warehouse.name;
    }

    if (toType === 'Warehouse') {
      const warehouse = await Warehouse.findOne({ id: toId }).session(session);
      if (!warehouse) throw new Error('Warehouse not found');
      toName = warehouse.name;
    } else if (toType === 'Outlet') {
      const outlet = await Outlet.findOne({ id: toId }).session(session);
      if (!outlet) throw new Error('Outlet not found');
      toName = outlet.name;
    }

    // 🔹 Validate all product SKUs exist
    for (const p of products) {
      const exists = await Product.findOne({ id: p.productId  }).session(session);
      if (!exists) throw new Error(`Product with id ${p.productId} not found`);
    }


    // 🔹 Add unitPrice from product document
   for (const p of products) {
  const prod = await Product.findOne({ id: p.productId }).session(session);
  if (!prod) throw new Error(`Product with id ${p.productId} not found`);

  if (p.qty > prod.qty) {
    throw new Error(`Cannot ship ${p.qty} units of ${prod.name}. Only ${prod.qty} in stock.`);
  }

  // attach unitPrice, sku, name
  p.unitPrice = prod.unitPrice;
  p.productSku = prod.sku;
  p.name = prod.name;
}


    // 🔹 Create shipment
    const shipment = new Shipment({
      id: uuidv4(),
      from: { id: fromId, name: fromName },
      to: { id: toId, name: toName },
      fromType,
      toType,
      products,
      status: 'In Transit',
      senderId,
      senderPhone,
      sentFrom: fromType
    });

    await shipment.save({ session });

    // 🔹 Deduct stock from source and update totals
    for (const p of products) {
      if (fromType === 'Company') {
        await Product.updateOne({ id: p.productId  }, 
          { $inc: { qty: -p.qty } }, 
          { session });
        await Company.updateOne(
          { id: fromId },
          { $inc: { inTransit: p.qty }, $set: { lastUpdated: new Date() } },
          { session }
        );
      } else if (fromType === 'Warehouse') {
        await WarehouseInventory.updateOne(
          { warehouseId: fromId, id: p.productId },
          { $inc: { inTransit: p.qty } },
          { session }
        );
      }
    }

    await session.commitTransaction();
    res.status(201).json({ message: 'Shipment created', shipment });
  } catch (err) {
    await session.abortTransaction();
    console.error('Shipment creation failed:', err);
    res.status(500).json({ message: 'Failed to create shipment', error: err.message });
  } finally {
    session.endSession();
  }
});



// UPDATE SHIPMENT STATUS
// UPDATE SHIPMENT STATUS
router.put('/shipments/:id/status', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    console.log('Request body:', req.body);           // log what frontend sent
    console.log('Request params:', req.params);       // log shipment ID

    const { status } = req.body;
    const shipment = await Shipment.findOne({ id: req.params.id }).session(session);

    if (!shipment) {
      console.error('Shipment not found with ID:', req.params.id);
      await session.abortTransaction();
      return res.status(404).json({ message: 'Shipment not found' });
    }

    if (status === 'cancelled' && shipment.status !== 'In Transit') {
  await session.abortTransaction();
  return res.status(400).json({ message: 'Only in-transit shipments can be cancelled' });
}


    
    shipment.status = status;
    shipment.lastUpdated = new Date();
    await shipment.save({ session });

    // 🔹 Handle stock adjustments for cancelled shipments
    if (status === 'cancelled') {
      for (const p of shipment.products) {
        if (shipment.fromType === 'Company') {
          console.log('Updating company stock for product', p.productId);
          await Company.updateOne(
            { id: shipment.from.id },
            { $inc: { inTransit: -p.qty } },
            { session }
          );
          await Product.updateOne(
            { id: p.productId },
            { $inc: { qty: p.qty } },
            { session }
          );
        } else if (shipment.fromType === 'Warehouse') {
          console.log('Updating warehouse stock for product', p.productId);
          await WarehouseInventory.updateOne(
            { warehouseId: shipment.from.id, productId: p.productId },
            { $inc: { inTransit: -p.qty } },
            { session }
          );
        }
      }
    }

    await session.commitTransaction();
    console.log('Shipment cancelled successfully:', shipment.id);
    res.json({ message: 'Shipment status updated', shipment });
  } catch (err) {
    await session.abortTransaction();
    console.error('Error cancelling shipment:', err);    // <-- full stack trace
    res.status(500).json({ message: 'Failed to update shipment', error: err.message, stack: err.stack });
  } finally {
    session.endSession();
  }
});




// GET ONE SHIPMENTS 
router.get('/shipments/:id', async (req, res) => {
  try {
    const shipment = await Shipment.findOne({ id: req.params.id });
    if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
    res.json(shipment);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch shipment', error: err.message });
  }
});

router.get('/test', (req, res) => {
  console.log('Test route hit!');
  res.json({ ok: true });
});


console.log('WAREHOUSE SHIPMENTS ROUTE LOADED - 2025');
// GET WAREHOUSE SHIPMENTS
// GET WAREHOUSE SHIPMENTS
// GET WAREHOUSE SHIPMENTS
router.get('/warehouse', ensureAuth, async (req, res) => {
      console.log('🔥 Route /shipments/warehouse HIT!');
  console.log('Query params:', req.query);
  console.log('Session user:', req.session.user);
 
  try {
    const user = req.session.user;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 15;  // default 15
    const skip = (page - 1) * limit;

    const warehouse = await Warehouse.findOne({ managerId: user.id });
    console.log('Warehouse found:', !!warehouse);
    console.log('Warehouse ID:', warehouse?.id);

    if (!warehouse) return res.json([]);

   const query = {
  $or: [
   { 'to.id': warehouse.id, toType: 'Warehouse' },
   { 'from.id': warehouse.id, fromType: 'Warehouse' }
]
};
 

    const shipments = await Shipment.find(query)
      .sort({ date: -1 })
      .skip(skip)
      .limit(limit);
      console.log('Shipments found:', shipments.length);

    const enriched = await Promise.all(shipments.map(async s => {
     const product = await Product.findOne({ id: s.products[0]?.productId });

      return {
        id: s.id,
        date: s.date,
        direction: s.to.id === warehouse.id ? 'Incoming' : 'Outgoing',
        fromName: s.from.name,
        toName: s.to.name,
        productName: product?.name || 'Items',
        qty: s.products.reduce((s, p) => s + p.qty, 0),
        status: s.status
      };
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ message: 'Error' });
  }
});


router.get('/shipments/outlet', ensureAuth, async (req, res) => {
   console.log('Outlet route hit');
   
  console.log('Session user:', req.session.user);
  try {
    const user = req.session.user;

    // get the outlet managed by this rep
    const outlet = await Outlet.findOne({ repId: user.id });
    if (!outlet) return res.status(404).json({ message: 'No outlet found' });

    // pagination params
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // fetch shipments sent to this outlet
    const shipments = await Shipment.find({ 'to.id': outlet.id, toType: 'Outlet' })
      .sort({ date: -1 })
      .skip(skip)
      .limit(limit);

    const enriched = await Promise.all(
      shipments.map(async s => {
        // fetch all product names by ID
        const productIds = s.products.map(p => p.productId);
        const products = await Product.find({ id: { $in: productIds } });
        const productNames = products.map(p => p.name).join(', ');

        const totalQty = s.products.reduce((sum, p) => sum + p.qty, 0);

        return {
          id: s.id,
          date: s.date.toISOString().slice(0, 10),
          direction: 'Incoming', // always incoming for outlet
          fromName: s.from.name,
          toName: s.to.name,
          productNames,   // all product names in shipment
          qty: totalQty,
          status: s.status
        };
      })
    );


    const totalCount = await Shipment.countDocuments({ 'to.id': outlet.id, toType: 'Outlet' });

    // return pagination info along with shipments
    res.json({
      page,
      limit,
      totalCount, 
      shipments: enriched
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error loading shipments' });
  }
});



// Approve shipment
// Approve shipment
router.put('/shipments/approve/:id', ensureAuth, ensureManager, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const shipment = await Shipment.findOne({ id: req.params.id }).session(session);
    if (!shipment) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Shipment not found' });
    }

    // Only approve if in transit
    if (shipment.status !== 'In Transit') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Shipment is not in transit' });
    }

    // Update shipment status
    shipment.status = 'Received';
    await shipment.save({ session });

    // Update source inventory
   // Update destination inventory
let totalQty = 0;
for (const p of shipment.products) {
  totalQty += p.qty;

  // Destination update
  if (shipment.toType === 'Warehouse') {
    await WarehouseInventory.updateOne(
  { warehouseId: shipment.to.id, productId: p.productId },
  { 
    $inc: { qty: p.qty, totalReceived: p.qty },
    $set: { sku: p.productSku, productName: p.name || p.productName, unitPrice: p.unitPrice || 0, status: 'inStock' },
    $setOnInsert: { createdAt: new Date() }
  },
  { session, upsert: true }
);

  } else if (shipment.toType === 'Outlet') {
   await OutletInventory.updateOne(
  { outletId: shipment.to.id, productId: p.productId },
  { 
    $inc: { qty: p.qty, totalReceived: p.qty },
    $set: { 
      lastUpdated: new Date(),
      sku: p.productSku,
      productName: p.name || p.productName,
      unitPrice: p.unitPrice || 0,
      status: 'inStock'
    },
    $setOnInsert: { createdAt: new Date() }
  },
  { session, upsert: true }
);

  }

  // Source update
  if (shipment.fromType === 'Company') {
    await Company.updateOne(
      { id: shipment.from.id, 'products.productId': p.productId },
      { $inc: { inTransit: -p.qty, 'products.$.qty': -p.qty, totalShipments: 1 } },
      { session }
    );
  } else if (shipment.fromType === 'Warehouse') {
    await WarehouseInventory.updateOne(
      { warehouseId: shipment.from.id, productId: p.productId },
      { $inc: { qty: -p.qty, totalShipped: p.qty } },
      { session }
    );
  }
}


if (shipment.toType === 'Warehouse') {
  await Warehouse.updateOne(
    { id: shipment.to.id },
    { $inc: { totalStock: totalQty, totalProducts: 1 } },
    { session }
  );
} else if (shipment.toType === 'Outlet') {
  await Outlet.updateOne(
    { id: shipment.to.id },
    { $inc: { totalStock: totalQty, totalProducts: 1 } },
    { session }
  );
}



    await session.commitTransaction();
    session.endSession();

    res.json({ message: 'Shipment approved and inventory updated', shipment });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('Shipment approval failed:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});


// Reject shipment
router.put('/shipments/reject/:id', ensureAuth, ensureManager, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const shipment = await Shipment.findOne({ id: req.params.id }).session(session);
    if (!shipment) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Shipment not found' });
    }

    // Only reject if in transit
    if (shipment.status !== 'In Transit') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Shipment is not in transit' });
    }

    // Update shipment status
    shipment.status = 'Rejected';
    await shipment.save({ session });

    // Return stock to source
    for (const p of shipment.products) {
      if (shipment.fromType === 'Company') {
        await Company.updateOne(
          { id: shipment.from.id },
          { $inc: { inTransit: -p.qty } },
          { session }
        );
        await Product.updateOne(
          { id: p.productId },
          { $inc: { qty: p.qty } }, // return units to company stock
          { session }
        );
      } else if (shipment.fromType === 'Warehouse') {
        await WarehouseInventory.updateOne(
          { warehouseId: shipment.from.id, productId: p.productId },
          { $inc: { inTransit: -p.qty } }, // return units to warehouse stock
          { session }
        );
      }
    }

    await session.commitTransaction();
    session.endSession();

    res.json({ message: 'Shipment rejected and stock returned', shipment });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('Shipment rejection failed:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});






// GET ALL SHIPMENTS 
router.get('/shipments', async (req, res) => {
  try {
    const shipments = await Shipment.find().sort({ date: -1 });

    const enriched = await Promise.all(
      shipments.map(async (s) => {
        const product = await Product.findOne({ sku: s.products[0]?.productSku });
        return {
          id: s.id,
          date: s.date.toISOString().slice(0, 10),
          productName: product?.name || '—',
          qty: s.products[0]?.qty || 0,
          unitPrice: s.products[0]?.unitPrice || 0,
          warehouseName: s.to.name,
          outletName: s.toType === 'Outlet' ? s.to.name : null,
          status: s.status,
          fromType: s.fromType,
          toType: s.toType
        };
      })
    );

    res.json({ totalShipments: enriched.length, data: enriched });

  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch shipments', error: err.message });
  }
});


module.exports = router;
