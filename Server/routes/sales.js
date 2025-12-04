const express = require('express');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const { ensureAuth } = require('../middlewares/auth');
const InventoryService = require('../services/inventoryService');
const Warehouse = require('../models/Warehouse');
const companyService = require('../services/companyService');
const Sale = require('../models/Sale');
const Product = require('../models/Product');
const Account = require('../models/Account');
const OutletInventory = require('../models/OutletInventory');
const OutletService = require('../services/outletService');
const Outlet = require('../models/Outlet');
const Company = require('../models/Company'); 


const router = express.Router();




/*router.post('/sales', ensureAuth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { outletId, productId, qtySold } = req.body;

  if (!outletId || outletId === 'null' || outletId === 'undefined') {
  await session.abortTransaction();
  session.endSession();
  return res.status(400).json({ message: 'Invalid outlet ID' });
}


    // 1️⃣ Get inventory
   const inventory = await OutletInventory.findOne({ 
  outletId, 
  productId 
}).session(session);

if (!inventory || inventory.qty < qtySold) {
  await session.abortTransaction();
  session.endSession();
  return res.status(400).json({ message: 'Insufficient stock.' });
}
   // Fetch product price
const product = await Product.findOne({ id: productId }).lean();
if (!product) return res.status(400).json({ message: 'Product not found.' });

const totalAmount = qtySold * product.unitPrice;


    // 2️⃣ Update inventory
   await OutletService.updateInventory(
  session,
  inventory.outletId,
  inventory.productId,
  qtySold,
  totalAmount
);

    // 3️⃣ Update outlet totals
    await OutletService.incrementOutlet(session, outletId, qtySold, totalAmount);

    // 4️⃣ Update warehouse totals
    await OutletService.incrementWarehouse(session, inventory.warehouseId, productId, totalAmount);

    // 5️⃣ Update company totals
    await companyService.incrementRevenue(session, totalAmount, qtySold);

    // 6️⃣ Record sale
    const sale = new Sale({
      id: uuidv4(),
      outletId,
      productId,
      qtySold,
      totalAmount,
      soldBy: req.session.user.id
    });
    await sale.save({ session });

    // ✅ Commit transaction
    await session.commitTransaction();
    session.endSession();

    res.json({ message: 'Sale recorded successfully.', sale });
  } catch (err) {
    console.log("TRANSACTION ERROR →", err);
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ message: 'Server error', error: err.message });
  }
}); */


router.post('/sales/bulk', ensureAuth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { outletId, items } = req.body;
    if (!outletId || !items?.length) throw new Error('Invalid request');

    const transactionId = uuidv4();  // One ID for the entire sale
    let totalSaleAmount = 0;

    // Calculate totals once
    const itemCount = items.length;
    const totalQty = items.reduce((sum, i) => sum + i.qtySold, 0);

    for (const item of items) {
      const { productId, qtySold } = item;

      const inventory = await OutletInventory.findOne({ outletId, productId }).session(session);
      if (!inventory || inventory.qty < qtySold) {
        throw new Error(`Insufficient stock for product ${productId}`);
      }

      const product = await Product.findOne({ id: productId }).lean();
      if (!product) throw new Error(`Product not found: ${productId}`);

      const totalAmount = qtySold * product.unitPrice;
      totalSaleAmount += totalAmount;

      await OutletService.updateInventory(session, inventory.outletId, inventory.productId, qtySold, totalAmount);
      await OutletService.incrementOutlet(session, outletId, qtySold, totalAmount);
      await OutletService.incrementWarehouse(session, inventory.warehouseId, productId, totalAmount);
      await companyService.incrementRevenue(session, totalAmount, qtySold);
      console.log("Updating warehouse revenue:", inventory.warehouseId, totalAmount);

      await Warehouse.updateOne(
  { id: inventory.warehouseId },
  { $inc: { totalRevenue: totalAmount } },
  { session }
);


      await Company.updateOne(
        {},      
        { $inc: { totalStock: -qtySold } }
      ).session(session);


      const sale = new Sale({
        id: uuidv4(),
        outletId,
        productId,
        qtySold,
        totalAmount,
        soldBy: req.session.user.id,
        transactionId,
        itemCount,      
      });
      await sale.save({ session });
    }

    await session.commitTransaction();
    res.json({ 
      message: 'Multi-product sale recorded successfully', 
      totalAmount: totalSaleAmount,
      transactionId,
      itemCount,
      totalQty 
    });

  } catch (err) {
    await session.abortTransaction();
    console.log("BULK SALE ERROR →", err);
    res.status(500).json({ message: err.message });
  } finally {
    session.endSession();
  }
});




// REVERSE SALE
router.post('/sales/:id/reverse', ensureAuth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const original = await Sale.findOne({ id: req.params.id }).session(session);
    if (!original)
      return res.status(404).json({ message: 'Sale not found' });

    // Prevent duplicate reversal
    const existing = await Sale.findOne({ reversedSaleId: original.id }).session(session);
    if (existing)
      return res.status(400).json({ message: 'Sale already reversed' });

    // 1️⃣ Reverse inventory changes
    const inventory = await outletService.getInventory(original.outletId, original.productId);
    if (!inventory)
      return res.status(400).json({ message: 'Inventory not found for reversal.' });

    // Add the sold quantity back to outlet inventory
    await InventoryService.reverseInventory(session, inventory.id, original.qtySold, original.totalAmount);

    // 2️⃣ Reverse outlet totals
    await outletService.decrementOutlet(session, original.outletId, original.qtySold, original.totalAmount);

    // 3️⃣ Reverse warehouse totals
    await outletService.decrementWarehouse(session, inventory.warehouseId, original.productId, original.totalAmount);

    // 4️⃣ Reverse company revenue
    await companyService.decrementRevenue(session, original.totalAmount, original.qtySold);

    // 5️⃣ Record reversal transaction
    const reversal = new Sale({
      id: `REV-${uuidv4()}`,
      outletId: original.outletId,
      productId: original.productId,
      qtySold: -original.qtySold,
      totalAmount: -original.totalAmount,
      soldBy: req.session.user.id,
      reversedSaleId: original.id,
      isReversal: true,
    });
    await reversal.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.json({ message: 'Sale reversed successfully.', reversal });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ message: 'Failed to reverse sale', error: err.message });
  }
});



// GET ALL SALES
/*router.get('/sales', ensureAuth, async (req, res) => {
  try {
    let { page = 1, limit = 10 } = req.query;
    page = parseInt(page);
    limit = parseInt(limit);
    const skip = (page - 1) * limit;

    const totalCount = await Sale.countDocuments();
    const sales = await Sale.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const enriched = await Promise.all(
  sales.map(async (s) => {
    const outlet = await OutletService.getById(s.outletId);
    const seller = await Account.findOne({ id: s.soldBy });
    const product = await Product.findOne({ id: s.productId });


    return {
      id: s.id,
      date: s.createdAt ? s.createdAt.toISOString().slice(0, 10) : '',
      totalAmount: s.totalAmount,
      outletName: outlet?.name || '—',
      repName: seller?.name || '—',
      status: 'Sold',
      sentFrom: 'Outlet',
      senderPhone: seller?.phone || '',
      items: [
        {
          productName: product?.name || '—',
          sku: product?.sku || '—',
          qty: s.qtySold,
          price: s.totalAmount
        }
      ]
    };
  })
);

res.json({
  page: Number(page),
  limit: Number(limit),
  totalPages: Math.ceil(totalCount / limit),
  totalCount,
  data: enriched
});

  } catch (err) {
    console.error('SALES ERROR:', err);
    res.status(500).json({ message: 'Failed to fetch sales', error: err.message });
  }
});*/

router.get('/sales', ensureAuth, async (req, res) => {
  try {
    let { page = 1, limit = 10, startDate, endDate } = req.query;
    page = Number(page); limit = Number(limit);
    const skip = (page - 1) * limit;

    // 1. Build filter (add date filter if needed)
    const filter = {};
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate + 'T23:59:59.999Z');
    }

    // 2. Get raw sales + total count
   const rawSales = await Sale.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    if (!rawSales.length) {
      return res.json({ data: [], totalCount: 0 });
    }

    // 3. Load all needed refs in bulk
    const productIds = [...new Set(rawSales.map(s => s.productId))];
    const outletIds  = [...new Set(rawSales.map(s => s.outletId))];
    const sellerIds  = [...new Set(rawSales.map(s => s.soldBy))];

    const [products, outlets, sellers] = await Promise.all([
      Product.find({ id: { $in: productIds } }).lean(),
      Outlet.find({ id: { $in: outletIds } }).lean(),
      Account.find({ id: { $in: sellerIds } }).lean()
    ]);

    const productMap = Object.fromEntries(products.map(p => [p.id, p]));
    const outletMap  = Object.fromEntries(outlets.map(o => [o.id.toString(), o]));
    const sellerMap  = Object.fromEntries(sellers.map(a => [a.id, a]));

    // 4. Group by transactionId (fallback to timestamp)
    const groups = {};
    for (const s of rawSales) {
      const key = s.transactionId;
      if (!groups[key]) groups[key] = [];
      groups[key].push(s);
    }

     const groupedCount = Object.keys(groups).length;

    // 5. Build final grouped response
    const data = Object.values(groups).map(g => {
      const first = g[0];
      const totalQty   = g.reduce((sum, x) => sum + x.qtySold, 0);
      const totalAmt   = g.reduce((sum, x) => sum + x.totalAmount, 0);

      return {
        id: first.transactionId,
        date: new Date(first.createdAt).toISOString().slice(0,10),
        time: new Date(first.createdAt).toTimeString().slice(0,8),
        itemCount: g.length,
        totalQty,
        totalAmount: totalAmt,
        outletName: outletMap[first.outletId]?.name || '—',
        repName:    sellerMap[first.soldBy]?.name || '—',
        status: 'Sold',
        sentFrom: outletMap[first.outletId]?.name || 'Unknown Outlet',
        senderPhone: sellerMap[first.soldBy]?.phone || '',
        items: g.map(s => ({
          productName: productMap[s.productId]?.name || '—',
          sku:         productMap[s.productId]?.sku || '—',
          qty:         s.qtySold,
          unitPrice:   productMap[s.productId]?.unitPrice || 0,
          amount:      s.totalAmount
        }))
      };
    });

    res.json({
      page,
      limit,
      totalCount : groupedCount,
      totalPages: Math.ceil(groupedCount / limit),
      data
    });

  } catch (err) {
    console.error('SALES ERROR:', err);
    res.status(500).json({ message: 'Failed to fetch sales', error: err.message });
  }
});




// GET SALES SUMMARY (total units + revenue)
// GET SALES SUMMARY (total units + revenue)
// GET SALES SUMMARY (total units + revenue)
router.get('/sales/summary', ensureAuth, async (req, res) => {
  const { startDate, endDate, outletId, warehouseId } = req.query;

  try {
    let filter = {};

    // Optional outlet filter
    if (outletId) filter.outletId = outletId;

    // Optional warehouse filter (aggregate from its outlets)
    if (warehouseId) {
      const outlets = await outletService.getByWarehouse(warehouseId);
      const outletIds = outlets.map(o => o.id);
      filter.outletId = { $in: outletIds };
    }

    // Optional date filter
    if (startDate && endDate) {
      filter.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const sales = await Sale.find(filter);

    const totalUnits = sales.reduce((sum, s) => sum + s.qtySold, 0);
    const totalRevenue = sales.reduce((sum, s) => sum + s.totalAmount, 0);

    res.json({
      units: totalUnits,
      revenue: totalRevenue
    });
  } catch (err) {
    console.error('Failed to fetch sales summary:', err);
    res.status(500).json({ message: 'Failed to fetch sales summary', error: err.message });
  }
});



// GET FULL SALES (by outlet or warehouse, with pagination + date filter)
// GET FULL SALES (by outlet or warehouse, with pagination + date filter)
// GET FULL SALES (by outlet or warehouse, with pagination + date filter)
router.get('/sales/full', ensureAuth, async (req, res) => {
  const { id, type, page = 1, limit = 10, startDate, endDate } = req.query;

  let warehouse = null;
  try {
    let filter = {};

    // 🔹 If viewing outlet sales
    if (type === 'outlet') {
      filter.outletId = id;
    }

    // 🔹 If viewing warehouse sales (aggregate from all its outlets)
    else if (type === 'warehouse') {
      warehouse = await Warehouse.findOne({ id });
      const outlets = await outletService.getByWarehouse(id);
      const outletIds = outlets.map(o => o.id);
      filter.outletId = { $in: outletIds };
    }

    // 🔹 Optional date range filter
    if (startDate && endDate) {
      filter.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    // 🔹 Get paginated results
    const sales = await Sale.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const totalCount = await Sale.countDocuments(filter);

    // 🔹 Enrich with product, outlet, and rep info
    const enriched = await Promise.all(
      sales.map(async (s) => {
        const outlet = await outletService.getById(s.outletId);
        const product = await Product.findOne({ id: s.productId });
        const seller = await Account.findOne({ id: s.soldBy });

        return {
          id: s.id,
          date: s.createdAt.toISOString().slice(0, 10),
          sku: product?.sku || '—', 
          productName: product?.name || '—',
          unitPrice: product?.unitPrice || 0,
          qty: s.qtySold,
          outletName: outlet?.name || '—',
          repName: seller?.name || '—',
          totalAmount: s.totalAmount,
          status: s.isReversal ? 'Reversed' : 'Sold',
          sentFrom: outlet?.name || 'Outlet',
          senderPhone: seller?.phone || ''
        };
      })
    );

    res.json({
      warehouseName: warehouse?.name || '—',
      page: Number(page),
      limit: Number(limit),
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      data: enriched
    });
  } catch (err) {
    console.error('Failed to fetch full sales:', err);
    res.status(500).json({ message: 'Failed to fetch full sales', error: err.message });
  }
});


// REPLACE your entire /outlet/sales route with this:
/*router.get('/outlet/sales', async (req, res) => {
  const { outletId, page = 1, limit = 20, startDate, endDate } = req.query;
  const user = req.session.user;

  try {
    // Build filter (same logic as before)
    const filter = { isReversal: false };

    if (user.role === 'rep') {
      const outlet = await Outlet.findOne({ repId: user.id }).lean();
      if (!outlet) return res.status(404).json({ message: 'No outlet assigned.' });
      filter.outletId = outlet.id;
    } 
    else if (user.role === 'manager') {
      const outlets = await outletService.getByManager(user.id);
      const managedIds = outlets.map(o => o.id);
      if (outletId) {
        if (!managedIds.includes(outletId)) 
          return res.status(403).json({ message: 'Access denied' });
        filter.outletId = outletId;
      } else {
        filter.outletId = { $in: managedIds };
      }
    } 
    else if (user.role === 'admin') {
      if (outletId) filter.outletId = outletId;
    } 
    else {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    if (startDate && endDate) {
      filter.createdAt = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }

    // Exact same simple method as /sales/full (the one that works!)
    const sales = await Sale.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const totalCount = await Sale.countDocuments(filter);

    const enriched = await Promise.all(sales.map(async (s) => {
      const product = await Product.findOne({ id: s.productId });
      const seller = await Account.findOne({ id: s.soldBy });
      const outlet = await outletService.getById(s.outletId);

      return {
        id: s.id,
        date: s.createdAt.toISOString().slice(0, 10),
        sku: product?.sku || '—',
        productName: product?.name || '—',
        qty: s.qtySold,
        repName: seller?.name || '—',
        outletName: outlet?.name || '—',
        totalAmount: s.totalAmount
      };
    }));

    res.json({
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(totalCount / limit),
      totalCount,
      data: enriched
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
}); */


module.exports = router;
