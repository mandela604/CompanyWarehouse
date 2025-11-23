const express = require('express');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const { ensureAuth } = require('../middlewares/auth');
const outletService = require('../services/inventoryService');
const companyService = require('../services/companyService');
const Sale = require('../models/Sale');
const Product = require('../models/Product');
const Account = require('../models/Account');


const router = express.Router();






router.post('/sales', ensureAuth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { outletId, productId, qtySold } = req.body;

    // 1️⃣ Get inventory
    const inventory = await outletService.getInventory(outletId, productId);
    if (!inventory || inventory.qty < qtySold)
      return res.status(400).json({ message: 'Insufficient stock.' });

    const totalAmount = qtySold * inventory.price;

    // 2️⃣ Update inventory
    await outletService.updateInventory(session, inventory.id, qtySold, totalAmount);

    // 3️⃣ Update outlet totals
    await outletService.incrementOutlet(session, outletId, qtySold, totalAmount);

    // 4️⃣ Update warehouse totals
    await outletService.incrementWarehouse(session, inventory.warehouseId, productId, totalAmount);

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
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ message: 'Server error', error: err.message });
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
    await outletService.reverseInventory(session, inventory.id, original.qtySold, original.totalAmount);

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
router.get('/sales', ensureAuth, async (req, res) => {
  try {
    const sales = await Sale.find().sort({ createdAt: -1 });

    // Enrich with product, outlet, and seller info
    const enriched = await Promise.all(
      sales.map(async (s) => {
        const outlet = await outletService.getById(s.outletId);
        const product = await Product.findOne({ id: s.productId });
        const seller = await Account.findOne({ id: s.soldBy });

        return {
          id: s.id,
          date: s.createdAt.toISOString().slice(0, 10),
          productName: product?.name || '—',
          qty: s.qtySold,
          outletName: outlet?.name || '—',
          repName: seller?.name || '—',
          status: 'Sold',            
          sentFrom: 'Outlet',        
          senderPhone: seller?.phone || ''
        };
      })
    );

    res.json(enriched);
  } catch (err) {
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
      const outlets = await outletService.getByWarehouseId(warehouseId);
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
      const outlets = await outletService.getByWarehouseId(id);
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



// GET /api/outlet/sales?page=1&limit=10&startDate=2025-11-01&endDate=2025-11-18
router.get('/outlet/sales', ensureAuth, async (req, res) => {
  try {
    const user = req.session.user;
    const page = Math.max(1, parseInt(req.query.page || '1'));
    const limit = Math.max(1, parseInt(req.query.limit || '10'));
    const skip = (page - 1) * limit;
    const { startDate, endDate } = req.query;

    // build filter
    const filter = { isReversal: false };

    // restrict by role: rep -> their outlet only; manager -> their outlets; admin -> allow ?outletId
    if (user.role === 'rep') {
      const outlet = await Outlet.findOne({ repId: user.id }).lean();
      if (!outlet) return res.status(404).json({ message: 'No outlet assigned.' });
      filter.outletId = outlet.id;
    } else if (user.role === 'manager') {
      const outlets = await outletService.getByManager(user.id);
      const ids = outlets.map(o => o.id);
      filter.outletId = { $in: ids };
    } else if (user.role === 'admin') {
      if (req.query.outletId) filter.outletId = req.query.outletId;
      // else admin sees all
    } else {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    if (startDate && endDate) {
      filter.createdAt = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }

    // Aggregation with lookups (products, accounts, outlets)
    const agg = [
      { $match: filter },
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: 'products',
          localField: 'productId',
          foreignField: 'id',
          as: 'product'
        }
      },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'accounts',
          localField: 'soldBy',
          foreignField: 'id',
          as: 'seller'
        }
      },
      { $unwind: { path: '$seller', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'outlets',
          localField: 'outletId',
          foreignField: 'id',
          as: 'outlet'
        }
      },
      { $unwind: { path: '$outlet', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          id: 1,
          createdAt: 1,
          qtySold: 1,
          totalAmount: 1,
          'product.name': 1,
          'product.sku': 1,
          'seller.name': 1,
          'seller.phone': 1,
          'outlet.name': 1
        }
      },
      // facet for pagination metadata
      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          totalCount: [{ $count: 'count' }]
        }
      }
    ];

    const result = await Sale.aggregate(agg);
    const data = result[0].data || [];
    const totalCount = (result[0].totalCount && result[0].totalCount[0]?.count) || 0;
    const totalPages = Math.ceil(totalCount / limit);

    // map to client shape
    const mapped = data.map(s => ({
      id: s.id,
      date: s.createdAt.toISOString().slice(0,10),
      sku: s.product?.sku || '—',
      productName: s.product?.name || '—',
      qty: s.qtySold,
      repName: s.seller?.name || '—',
      outletName: s.outlet?.name || '—',
      totalAmount: s.totalAmount
    }));

    res.json({
      page,
      limit,
      totalPages,
      totalCount,
      data: mapped
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});



module.exports = router;
