const express = require('express');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const { ensureAuth } = require('../middlewares/auth');
const Layaway = require('../models/Layaway');
const Sale = require('../models/Sale');           // ← assuming you have a Sale model
const OutletInventory = require('../models/OutletInventory');
const Outlet = require('../models/Outlet');
const Product = require('../models/Product');

const router = express.Router();

// ────────────────────────────────────────────────────────────────
// POST /api/layaway - Create new layaway (already good, minor safety)
// ────────────────────────────────────────────────────────────────
router.post('/layaway', ensureAuth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { outletId, customerName, items, paidNow, total, balance } = req.body;

    if (!outletId || !Array.isArray(items) || items.length === 0 || total <= 0 || paidNow < 0) {
      throw new Error('Invalid layaway data');
    }

    if (paidNow > total) {
      throw new Error("Paid amount cannot exceed total");
    }

    // Verify outlet & user access
    const outlet = await Outlet.findOne({ id: outletId }).session(session);
    if (!outlet) throw new Error('Outlet not found');

    const user = req.user; // from ensureAuth
    const hasAccess = 
      outlet.repId === user.id ||
      (outlet.repIds || []).includes(user.id) ||
      user.role === 'admin';

    if (!hasAccess) throw new Error('Unauthorized for this outlet');

    // Validate stock (do NOT deduct yet — layaway is pending)
    for (const item of items) {
      const product = await Product.findOne({ id: item.productId }).session(session);
      if (!product) throw new Error(`Product not found: ${item.productId}`);

      const inventory = await OutletInventory.findOne({
        outletId,
        productId: item.productId
      }).session(session);

      if (!inventory || inventory.qty < item.qtyRequested) {
        throw new Error(`Insufficient stock for ${product.name} (only ${inventory?.qty || 0} left)`);
      }

      // Enrich item for display
      item.productName = product.name;
      item.sku = product.sku || '';
    }

    const layaway = new Layaway({
      id: `LAY-${uuidv4().slice(0, 8).toUpperCase()}`,
      outletId,
      repId: user.id,
      repName: user.name,
      customerName: customerName?.trim() || 'Walk-in',
      items,
      totalAmount: total,
      paidAmount: paidNow,
      balance,
      status: balance <= 0 ? 'full_paid_pending_pickup' : 'pending_payment',
      createdAt: new Date(),
      payments: [{
        amount: paidNow,
        date: new Date(),
        recordedBy: user.id,
        recordedByName: user.name
      }]
    });

    await layaway.save({ session });

    await session.commitTransaction();
    res.status(201).json({
      success: true,
      message: 'Layaway created successfully',
      layaway
    });

  } catch (err) {
    await session.abortTransaction();
    console.error('Layaway create error:', err);
    res.status(400).json({ success: false, message: err.message || 'Failed to create layaway' });
  } finally {
    session.endSession();
  }
});

// ────────────────────────────────────────────────────────────────
// GET /api/layaway - List + stats (already good)
// ────────────────────────────────────────────────────────────────
router.get('/layaway', ensureAuth, async (req, res) => {
  try {
    let { page = 1, limit = 10, outletId } = req.query;
    page = parseInt(page);
    limit = parseInt(limit);

    if (!outletId) {
      const user = req.user;
      if (user.role === 'rep') {
        const outlet = await Outlet.findOne({
          $or: [{ repId: user.id }, { repIds: user.id }]
        }).lean();
        if (!outlet) return res.status(403).json({ message: 'No outlet assigned' });
        outletId = outlet.id;
      } else {
        return res.status(400).json({ message: 'outletId required for non-rep users' });
      }
    }

    const skip = (page - 1) * limit;
    const filter = { outletId };

    const [orders, totalCount, statsResult] = await Promise.all([
      Layaway.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Layaway.countDocuments(filter),
      Layaway.aggregate([
        { $match: { outletId } },
        {
          $group: {
            _id: null,
            pending: { $sum: { $cond: [{ $eq: ['$status', 'pending_payment'] }, 1, 0] } },
            awaitingPickup: { $sum: { $cond: [{ $eq: ['$status', 'full_paid_pending_pickup'] }, 1, 0] } },
            totalBalance: { $sum: '$balance' }
          }
        }
      ])
    ]);

    res.json({
      orders,
      totalCount,
      page,
      totalPages: Math.ceil(totalCount / limit),
      stats: statsResult[0] || { pending: 0, awaitingPickup: 0, totalBalance: 0 }
    });

  } catch (err) {
    console.error('Layaway list error:', err);
    res.status(500).json({ message: 'Failed to load layaway orders' });
  }
});


router.get('/layaway/:id', ensureAuth, async (req, res) => {
  try {
    const { id } = req.params;               // "LAY-920cb34e"
    const { outletId } = req.query;

    if (!outletId) {
      return res.status(400).json({ message: 'outletId is required' });
    }

    const layaway = await Layaway.findOne({ 
      id: id,                                // your custom string ID
      outletId: outletId 
    });

    if (!layaway) {
      return res.status(404).json({ message: 'Layaway order not found' });
    }

    res.json(layaway);
  } catch (err) {
    console.error('Error fetching single layaway:', err);
    res.status(500).json({ message: 'Server error' });
  }
});
// ────────────────────────────────────────────────────────────────
// PUT /api/layaway/:id/update - Update items + add payment
// ────────────────────────────────────────────────────────────────
router.put('/layaway/:id/update', ensureAuth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { outletId, items, additionalPayment = 0 } = req.body;

    if (!outletId || additionalPayment < 0) {
      throw new Error('Invalid update data');
    }

    const layaway = await Layaway.findOne({ id, outletId }).session(session);
    if (!layaway) throw new Error('Layaway order not found');

    if (layaway.status === 'completed') {
      throw new Error('Cannot update a completed layaway');
    }

    // If items are being updated → validate stock
    if (items && Array.isArray(items)) {
      for (const item of items) {
        const inv = await OutletInventory.findOne({
          outletId,
          productId: item.productId
        }).session(session);

        if (!inv || inv.qty < item.qtyRequested) {
          throw new Error(`Insufficient stock for product ${item.productId}`);
        }
      }
      layaway.items = items;
    }

    // Update payment
    if (additionalPayment > 0) {
      layaway.paidAmount += additionalPayment;
      layaway.balance = layaway.totalAmount - layaway.paidAmount;
      layaway.payments.push({
        amount: additionalPayment,
        date: new Date(),
        recordedBy: req.user.id,
        recordedByName: req.user.name
      });
    }

    // Auto-update status
    layaway.status = layaway.balance <= 0 ? 'full_paid_pending_pickup' : 'pending_payment';
    layaway.updatedAt = new Date();

    await layaway.save({ session });

    await session.commitTransaction();

    res.json({
      success: true,
      message: 'Layaway updated',
      layaway
    });

  } catch (err) {
    await session.abortTransaction();
    console.error('Layaway update error:', err);
    res.status(400).json({ success: false, message: err.message || 'Failed to update layaway' });
  } finally {
    session.endSession();
  }
});

// ────────────────────────────────────────────────────────────────
// PUT /api/layaway/:id/complete - FINALIZE: Turn layaway into real sale
// ────────────────────────────────────────────────────────────────

router.put('/:id/complete', ensureAuth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { outletId } = req.body;

    if (!outletId) throw new Error('outletId is required');

    // Load layaway
    const layaway = await Layaway.findOne({ id, outletId }).session(session);
    if (!layaway) throw new Error('Layaway not found');

    // Must be fully paid
    if (layaway.balance > 0) {
      throw new Error(`Cannot complete — balance still ₦${layaway.balance}`);
    }

    if (layaway.status === 'completed') {
      throw new Error('Layaway already completed');
    }

    // Prepare items in same format bulk sales expects
    const items = layaway.items.map(item => ({
      productId: item.productId,
      qtySold: item.qtyRequested,
      unitPrice: item.unitPrice
    }));

    if (!items?.length) throw new Error('No items in layaway');

    let totalSaleAmount = 0;

    // ──── EVERYTHING BELOW IS COPY-PASTED FROM YOUR /sales/bulk ROUTE ────

    const transactionId = uuidv4();  // One ID for the entire sale
    let totalQty = 0;

    for (const item of items) {
      const { productId, qtySold, unitPrice } = item;

      if (unitPrice == null || typeof unitPrice !== 'number' || unitPrice < 0) {
        throw new Error(`Missing or invalid unitPrice for product ${productId}`);
      }

      const inventory = await OutletInventory.findOne({ outletId, productId }).session(session);
      if (!inventory || inventory.qty < qtySold) {
        throw new Error(`Insufficient stock for product ${productId}`);
      }

      const lineTotal = qtySold * unitPrice;
      totalSaleAmount += lineTotal;
      totalQty += qtySold;

      await OutletService.updateInventory(session, inventory.outletId, inventory.productId, qtySold, lineTotal);
      await OutletService.incrementOutlet(session, outletId, qtySold, lineTotal);

      const outlet = await Outlet.findOne({ id: outletId }).session(session);
      if (!outlet) throw new Error(`Outlet not found: ${outletId}`);

      const warehouseId = outlet.warehouseId;

      // Warehouse revenue
      await Warehouse.updateOne(
        { id: warehouseId },
        { $inc: { totalRevenue: lineTotal } },
        { session }
      );

      await companyService.incrementRevenue(session, lineTotal, qtySold);

      await Company.updateOne(
        {},
        { $inc: { totalStock: -qtySold } }
      ).session(session);

      const sale = new Sale({
        id: uuidv4(),
        outletId,
        productId,
        qtySold,
        unitPrice: unitPrice,
        totalAmount: lineTotal,
        soldBy: req.session.user.id,
        transactionId,
        itemCount: items.length,
        customerName: layaway.customerName || 'Layaway Customer',
        source: 'layaway',
        sourceId: layaway.id,
        createdAt: new Date()
      });
      await sale.save({ session });
    }

    // ──── END OF COPY-PASTE FROM BULK SALES ────

    // Mark layaway complete
    layaway.status = 'completed';
    layaway.completedAt = new Date();
    layaway.saleTransactionId = transactionId;
    await layaway.save({ session });

    await session.commitTransaction();

    res.json({
      message: 'Layaway fully collected and recorded as sale',
      transactionId,
      totalAmount: totalSaleAmount,
      totalQty,
      itemCount: items.length
    });

  } catch (err) {
    await session.abortTransaction();
    console.log("LAYAWAY COMPLETE ERROR →", err);
    res.status(400).json({ message: err.message || 'Failed to complete layaway' });
  } finally {
    session.endSession();
  }
});



router.delete('/layaway/:id', ensureAuth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const layaway = await Layaway.findOne({ id: req.params.id }).session(session);
    if (!layaway) throw new Error('Layaway not found');

    if (layaway.status === 'completed') {
      throw new Error('Completed layaway cannot be cancelled');
    }

    // Optional: if you want to restore any reserved stock logic later, do it here

    await Layaway.deleteOne({ id: layaway.id }, { session });

    await session.commitTransaction();
    session.endSession();

    res.json({ message: 'Layaway cancelled/deleted successfully' });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    res.status(400).json({ message: err.message || 'Failed to cancel layaway' });
  }
});


module.exports = router;