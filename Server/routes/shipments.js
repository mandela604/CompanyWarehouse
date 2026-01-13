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

    if (fromType === 'Warehouse' && toType === 'Warehouse' && fromId === toId) {
  await session.abortTransaction();
  return res.status(400).json({ message: 'Warehouse cannot ship to itself' });
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


    // 🔹 Add unitPrice from product/wareInventory document
for (const p of products) {
  
  if (fromType === 'Company') {
  const prod = await Product.findOne({ id: p.productId }).session(session);
  if (!prod || p.qty > prod.qty) {
    throw new Error('Not enough company stock');
  }

  p.unitPrice = prod.unitPrice;
  p.productSku = prod.sku;
  p.name = prod.name;

} else if (fromType === 'Warehouse') {
  const whInv = await WarehouseInventory.findOne({
    warehouseId: fromId,
    productId: p.productId
  }).session(session);

  if (!whInv || p.qty > whInv.qty) {
    throw new Error('Not enough warehouse stock');
  }

  p.unitPrice = whInv.unitPrice;
  p.productSku = whInv.sku;
  p.name = whInv.productName;
}

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
          { warehouseId: fromId, productId: p.productId },
          { $inc: { qty: -p.qty, inTransit: p.qty } },
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


// GET WAREHOUSE SHIPMENTS
// GET WAREHOUSE SHIPMENTS
// GET WAREHOUSE SHIPMENTS
router.get('/warehouse', ensureAuth, async (req, res) => {
 
  try {

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 15;  // default 15
    const skip = (page - 1) * limit;

const user = req.session.user;
let warehouse;

if (user.role === 'admin' && req.query.warehouseId) {
  warehouse = await Warehouse.findOne({ id: req.query.warehouseId });
} else {
  warehouse = await Warehouse.findOne({ managerId: user.id });
}

if (!warehouse) return res.json([]);

  const query = {
  'to.id': warehouse.id,
  toType: 'Warehouse'
};

 

    const shipments = await Shipment.find(query)
      .sort({ date: -1 })
      .skip(skip)
      .limit(limit);
      console.log('Shipments found:', shipments.length);

    const enriched = shipments.map(s => ({
  id: s.id,
  date: s.date,
  fromName: s.from?.name || 'Head Office',
  status: s.status,
  products: s.products.map(p => ({
    name: p.name || p.productName || 'Unknown',
    qty: p.qty,
    unitPrice: p.unitPrice || 0   // ← this is what frontend needs
  }))
}));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ message: 'Error' });
  }
});


router.get('/outlet-shipments', ensureAuth, async (req, res) => {
  console.log('Outlet shipments route hit');

  try {
    const user = req.session.user;
    let outletId;

    // Resolve outletId based on role
    if (user.role === 'rep') {
  const outlet = await Outlet.findOne({
    $or: [
      { repId: user.id },
      { repIds: user.id }
    ]
  }).lean();

  if (!outlet) return res.status(404).json({ message: 'No outlet assigned' });
  outletId = outlet.id;
} else {
      outletId = req.query.outletId?.trim();
      if (!outletId) return res.status(400).json({ message: 'outletId required' });
    }

    // Optional: validate outlet exists + manager access
    const outlet = await Outlet.findOne({ id: outletId }).lean();
    if (!outlet) return res.status(404).json({ message: 'Outlet not found' });

    if (user.role === 'manager') {
      const warehouse = await Warehouse.findOne({ managerId: user.id }).lean();
       if (!warehouse) {
    return res.status(403).json({ message: 'Invalid warehouse access' });
      }
    }

    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Fetch shipments for this outlet
    const shipments = await Shipment.find({ 'to.id': outletId, toType: 'Outlet' })
      .sort({ date: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

   const enriched = await Promise.all(
  shipments.map(async (s) => {
    const productIds = s.products.map(p => p.productId);
    const products = await Product.find({ id: { $in: productIds } }).lean();

    // Build enriched products array with name + price
    const enrichedProducts = s.products.map(sp => {
      const fullProduct = products.find(p => p.id === sp.productId);
      return {
        productName: fullProduct?.name || 'Unknown',
        qty: sp.qty,
        unitPrice: fullProduct?.unitPrice || 0
      };
    });

    const totalQty = enrichedProducts.reduce((sum, p) => sum + p.qty, 0);
    const totalValue = enrichedProducts.reduce((sum, p) => sum + (p.qty * p.unitPrice), 0);

    return {
      id: s.id,
      date: s.date.toISOString().slice(0, 10),
      fromName: s.from?.name || 'Unknown',
      products: enrichedProducts,        // ← THIS IS THE KEY: send full product details
      totalQty,
      totalValue,                        // ← optional: pre-calculate on backend
      status: s.status
    };
  })
);

    const totalCount = await Shipment.countDocuments({ 'to.id': outletId, toType: 'Outlet' });

    res.json({
      page,
      limit,
      totalCount,
      shipments: enriched
    });

  } catch (err) {
    console.error('Shipments error:', err);
    res.status(500).json({ message: 'Error loading shipments' });
  }
});



// Approve shipment
// Approve shipment
/*router.put('/shipments/approve/:id', ensureAuth, async (req, res) => {
     console.error('Shipments :', req.body);
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
  const warehouseId = shipment.fromType === 'Warehouse' ? shipment.from.id : null;

   await OutletInventory.updateOne(
  { outletId: shipment.to.id, productId: p.productId },
  { 
    $inc: { qty: p.qty, totalReceived: p.qty },
    $set: { 
      lastUpdated: new Date(),
      sku: p.productSku,
      productName: p.name || p.productName,
      unitPrice: p.unitPrice || 0,
      status: 'inStock',
      ...(warehouseId && { warehouseId })
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
      { $inc: {  inTransit: -p.qty, totalShipped: p.qty } },
      { session }
    );

      await Warehouse.updateOne(
    { id: shipment.from.id },
    { $inc: { totalStock: -p.qty, totalShipments: p.qty } },
    { session }
  );
  }
}


// After the FOR loop
if (shipment.toType === 'Warehouse') {

 let newProducts = 0;

for (const p of shipment.products) {
  const existed = await WarehouseInventory.findOne(
    { warehouseId: shipment.to.id, productId: p.productId }
  ).session(session);

  if (!existed) newProducts++;

  await WarehouseInventory.updateOne(
    { warehouseId: shipment.to.id, productId: p.productId },
    {
      $inc: { qty: p.qty, totalReceived: p.qty },
      $set: {
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


  await Warehouse.updateOne(
    { id: shipment.to.id },
    { 
      $inc: { 
        totalStock: totalQty,
        totalProducts: newProducts
      }
    },
    { session }
  );
}

else if (shipment.toType === 'Outlet') {

  let newProducts = 0;

  for (const p of shipment.products) {
    const exists = await OutletInventory.findOne(
      { outletId: shipment.to.id, productId: p.productId }
    ).session(session);

    if (!exists) newProducts++;
  }

  await Outlet.updateOne(
    { id: shipment.to.id },
    { 
      $inc: { 
        totalStock: totalQty,
        totalProducts: newProducts
      } 
    },
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
}); */

router.put('/shipments/approve/:id', ensureAuth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 🔒 Atomic approval (prevents double approve)
    const shipment = await Shipment.findOneAndUpdate(
      { id: req.params.id, status: 'In Transit' },
      { $set: { status: 'Received' } },
      { session, new: true }
    );

    if (!shipment) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Shipment already approved or invalid' });
    }

    let totalQty = 0;
    let newProducts = 0;

    for (const p of shipment.products) {
      totalQty += p.qty;

      // ================= DESTINATION =================
      if (shipment.toType === 'Warehouse') {
        const existed = await WarehouseInventory.findOne(
          { warehouseId: shipment.to.id, productId: p.productId }
        ).session(session);

        if (!existed) newProducts++;

        await WarehouseInventory.updateOne(
          { warehouseId: shipment.to.id, productId: p.productId },
          {
            $inc: { qty: p.qty, totalReceived: p.qty },
            $set: {
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

      if (shipment.toType === 'Outlet') {
        const existed = await OutletInventory.findOne(
          { outletId: shipment.to.id, productId: p.productId }
        ).session(session);

        if (!existed) newProducts++;

        const warehouseId =
          shipment.fromType === 'Warehouse' ? shipment.from.id : null;

        await OutletInventory.updateOne(
          { outletId: shipment.to.id, productId: p.productId },
          {
            $inc: { qty: p.qty, totalReceived: p.qty },
            $set: {
              sku: p.productSku,
              productName: p.name || p.productName,
              unitPrice: p.unitPrice || 0,
              status: 'inStock',
              ...(warehouseId && { warehouseId }),
              lastUpdated: new Date()
            },
            $setOnInsert: { createdAt: new Date() }
          },
          { session, upsert: true }
        );
      }

      // ================= SOURCE =================
      if (shipment.fromType === 'Company') {
        await Company.updateOne(
          { id: shipment.from.id, 'products.productId': p.productId },
          {
            $inc: {
              inTransit: -p.qty,
              'products.$.qty': -p.qty,
              totalShipments: 1
            }
          },
          { session }
        );
      }

      if (shipment.fromType === 'Warehouse') {
        await WarehouseInventory.updateOne(
          { warehouseId: shipment.from.id, productId: p.productId },
          { $inc: { inTransit: -p.qty, totalShipped: p.qty } },
          { session }
        );

        await Warehouse.updateOne(
          { id: shipment.from.id },
          { $inc: { totalStock: -p.qty, totalShipments: p.qty } },
          { session }
        );
      }
    }

    // ================= TOTALS =================
    if (shipment.toType === 'Warehouse') {
      await Warehouse.updateOne(
        { id: shipment.to.id },
        { $inc: { totalStock: totalQty, totalProducts: newProducts } },
        { session }
      );
    }

    if (shipment.toType === 'Outlet') {
      await Outlet.updateOne(
        { id: shipment.to.id },
        { $inc: { totalStock: totalQty, totalProducts: newProducts } },
        { session }
      );
    }

    await session.commitTransaction();
    session.endSession();

    res.json({ message: 'Shipment approved successfully', shipment });
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
    // Find shipments from Company to Warehouse, newest first
    const shipments = await Shipment.find({
      fromType: 'Company',
      toType: 'Warehouse'
    })
    .populate('to', 'name location')  // populate warehouse name
    .sort({ date: -1 });

    // Group and enrich properly
    const enriched = await Promise.all(
      shipments.map(async (s) => {
        // Populate all products in this shipment
        const populatedProducts = await Promise.all(
          s.products.map(async (p) => {
            const product = await Product.findOne({ sku: p.productSku });
            return {
              productName: product?.name || 'Unknown Product',
              productSku: p.productSku,
              qty: p.qty,
              unitPrice: p.unitPrice || 0
            };
          })
        );

        return {
          id: s.id,
          date: s.date,
          products: populatedProducts,        // ← NOW AN ARRAY
          to: {
            name: s.to?.name || 'Unknown Warehouse'
          },
          status: s.status,
          warehouseName: s.to?.name || '—'
        };
      })
    );

    res.json({ data: enriched });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch shipments', error: err.message });
  }
});


// UPDATE SHIPMENT (full replace of destination & products)
router.put('/shipments/:id', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { toId, products } = req.body;

    if (!toId || !products?.length) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Missing toId or products' });
    }

    const shipment = await Shipment.findOne({ id }).session(session);
    if (!shipment) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Shipment not found' });
    }

    if (shipment.status !== 'In Transit') {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Only In Transit shipments can be edited' });
    }

    // Fetch new destination name
    let toName;
    const warehouse = await Warehouse.findOne({ id: toId }).session(session);
    if (warehouse) {
      toName = warehouse.name;
    } else {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Destination warehouse not found' });
    }

    // Optional: validate products exist + stock (similar to create)
    for (const p of products) {
      const prod = await Product.findOne({ id: p.productId }).session(session);
      if (!prod) throw new Error(`Product ${p.productId} not found`);
      // You can add stock check here if needed
    }

    // Update shipment
    shipment.to = { id: toId, name: toName };
    shipment.products = products.map(p => ({
      ...p,
      unitPrice: p.unitPrice || 0, // ensure price is kept
      name: p.name || 'Unknown'    // optional
    }));
    shipment.lastUpdated = new Date();

    await shipment.save({ session });

    await session.commitTransaction();
    res.json({ message: 'Shipment updated', shipment });

  } catch (err) {
    await session.abortTransaction();
    console.error('Shipment update failed:', err);
    res.status(500).json({ message: 'Failed to update shipment', error: err.message });
  } finally {
    session.endSession();
  }
});

module.exports = router;
