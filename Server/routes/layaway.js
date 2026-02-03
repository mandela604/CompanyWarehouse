const express = require('express');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const { ensureAuth } = require('../middlewares/auth');
const Layaway = require('../models/Layaway'); // ← create this model below
const OutletInventory = require('../models/OutletInventory');
const Outlet = require('../models/Outlet');
const Product = require('../models/Product');
const Company = require('../models/Company');

const router = express.Router();

// ─── 1. POST /api/layaway ────────────────────────────────────────────────
// Create new layaway order (partial or full payment)
router.post('/layaway', ensureAuth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { outletId, customerName, items, paidNow, total, balance } = req.body;

    if (!outletId || !items?.length || total <= 0 || paidNow < 0) {
      throw new Error('Invalid layaway data');
    }

    if (paidNow > total) {
      throw new Error("Paid amount can't exceed total");
    }

    // Validate outlet exists and user has access
    const outlet = await Outlet.findOne({ id: outletId }).session(session);
    if (!outlet) throw new Error('Outlet not found');

    const user = req.session.user;
    const isAssigned = 
      outlet.repId === user.id ||
      (Array.isArray(outlet.repIds) && outlet.repIds.includes(user.id));

    if (!isAssigned && user.role !== 'admin') {
      throw new Error('You do not have access to this outlet');
    }

    // Validate all products exist and stock is sufficient (but DO NOT deduct yet)
    for (const item of items) {
      const product = await Product.findOne({ id: item.productId }).session(session);
      if (!product) throw new Error(`Product ${item.productId} not found`);

      const inv = await OutletInventory.findOne({
        outletId,
        productId: item.productId
      }).session(session);

      if (!inv || inv.qty < item.qtyRequested) {
        throw new Error(`Insufficient stock for ${product.name}`);
      }

      // Attach full product info for display later
      item.productName = product.name;
      item.sku = product.sku;
    }

    // Create layaway order
    const layaway = new Layaway({
      id: `LAY-${uuidv4().slice(0, 8)}`,
      outletId,
      repId: user.id,
      repName: user.name,
      customerName: customerName || 'Walk-in',
      items,
      totalAmount: total,
      paidAmount: paidNow,
      balance,
      status: balance === 0 ? 'full_paid_pending_pickup' : 'pending_payment',
      createdAt: new Date(),
      payments: [{ amount: paidNow, date: new Date(), recordedBy: user.id }]
    });

    await layaway.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      message: 'Layaway recorded successfully',
      layaway
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('Layaway creation error:', err);
    res.status(400).json({ message: err.message || 'Failed to record layaway' });
  }
});

// ─── 2. GET /api/layaway ─────────────────────────────────────────────────
// List layaway orders for an outlet (paginated + stats)
router.get('/layaway', ensureAuth, async (req, res) => {
  try {
    let { page = 1, limit = 10, outletId } = req.query;
    page = Number(page);
    limit = Number(limit);

    if (!outletId) {
      const user = req.session.user;
      if (user.role === 'rep') {
        const outlet = await Outlet.findOne({
          $or: [{ repId: user.id }, { repIds: user.id }]
        }).lean();
        if (!outlet) return res.status(404).json({ message: 'No outlet assigned' });
        outletId = outlet.id;
      } else {
        return res.status(400).json({ message: 'outletId required' });
      }
    }

    const skip = (page - 1) * limit;

    const filter = { outletId };

    const [orders, totalCount] = await Promise.all([
      Layaway.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Layaway.countDocuments(filter)
    ]);

    // Stats for cards
    const stats = await Layaway.aggregate([
      { $match: { outletId } },
      {
        $group: {
          _id: null,
          pending: {
            $sum: { $cond: [{ $eq: ['$status', 'pending_payment'] }, 1, 0] }
          },
          awaitingPickup: {
            $sum: { $cond: [{ $eq: ['$status', 'full_paid_pending_pickup'] }, 1, 0] }
          },
          totalBalance: { $sum: '$balance' }
        }
      }
    ]);

    res.json({
      orders,
      totalCount,
      page,
      totalPages: Math.ceil(totalCount / limit),
      stats: stats[0] || { pending: 0, awaitingPickup: 0, totalBalance: 0 }
    });

  } catch (err) {
    console.error('Layaway list error:', err);
    res.status(500).json({ message: 'Failed to load layaway orders' });
  }
});

module.exports = router;