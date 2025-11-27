const express = require('express');
const { v4: uuidv4 } = require('uuid');
const validator = require('validator');
const mongoose = require('mongoose');
const { ensureAuth, ensureAdmin } = require('../middlewares/auth');
const warehouseService = require('../services/warehouseService');
const companyService = require('../services/companyService');
const Outlet = require('../models/Outlet');
const Warehouse = require('../models/Warehouse');
const Sale = require('../models/Sale');
const Product = require('../models/Product');
const Account = require('../models/Account');

const router = express.Router();

// ✅ CREATE WAREHOUSE (Admin only)
router.post('/warehouses', ensureAdmin, async (req, res) => {
  try {
    let { name, location, address, managerId, manager, status } = req.body;

    if (!name || !location)
      return res.status(400).json({ message: 'Name and location are required.' });

    // Sanitize inputs
    name = validator.escape(name.trim());
    location = validator.escape(location.trim());
    address = address ? validator.escape(address.trim()) : '';
    status = status ? validator.escape(status.trim()) : 'active';

    const newWarehouse = {
      id: uuidv4(),
      name,
      location,
      address,
      managerId: managerId || null,
      manager: manager || null,
      status,
      createdAt: new Date(),
      lastUpdated: new Date()
    };

    const savedWarehouse = await warehouseService.createWarehouse(newWarehouse);
    await companyService.incrementTotalWarehouses();
    res.status(201).json({ message: 'Warehouse created successfully.', warehouse: savedWarehouse });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ✅ GET ALL WAREHOUSES (Admin only)
router.get('/warehouses', ensureAdmin, async (req, res) => {
  try {
    const warehouses = await warehouseService.getAllWarehouses();
    res.json(warehouses);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});




// ✅ GET SINGLE WAREHOUSE (Admin or assigned Manager)
router.get('/warehouses/:id', ensureAuth, async (req, res) => {
  try {
    const warehouse = await warehouseService.getWarehouseById(req.params.id);
    if (!warehouse) return res.status(404).json({ message: 'Warehouse not found.' });

    const user = req.session.user;
    if (user.role !== 'admin' && warehouse.managerId !== user.id)
      return res.status(403).json({ message: 'Access denied.' });

    res.json(warehouse);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});



// GET warehouse stock summary (for quick stats widget)
// GET warehouse stock summary (for quick stats widget)
// GET warehouse stock summary (for quick stats widget)
router.get('/stats/warehouse-stock', ensureAdmin, async (req, res) => {
  try {
    const stats = await warehouseService.getWarehouseStockSummary(); // you will add this method
    res.json(stats);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});



// GET /api/warehouse/my → Returns current manager's warehouse + permissions
router.get('/warehouse/my', ensureAuth, async (req, res) => {
  try {
    const user = req.session.user;

    
   // Allow only admin and manager
    if (!['admin', 'manager'].includes(user.role)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const data = await warehouseService.getMyWarehouseData(user.id);
    if (!data) {
      return res.status(404).json({ message: 'No warehouse assigned to you' });
    }

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});



// ✅ UPDATE WAREHOUSE (Admin or assigned Manager)
router.put('/warehouses/:id', ensureAuth, async (req, res) => {
  try {
    const warehouse = await warehouseService.getWarehouseById(req.params.id);
    if (!warehouse) return res.status(404).json({ message: 'Warehouse not found.' });

    const user = req.session.user;
    if (user.role !== 'admin' && warehouse.managerId !== user.id)
      return res.status(403).json({ message: 'Access denied.' });

    const updates = req.body;
    updates.lastUpdated = new Date();

    const updatedWarehouse = await warehouseService.updateWarehouse(req.params.id, updates);
    res.json({ message: 'Warehouse updated successfully.', warehouse: updatedWarehouse });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ✅ DELETE WAREHOUSE (Admin only)
// ✅ DELETE WAREHOUSE (Admin only)
// ✅ DELETE WAREHOUSE (Admin only)
router.delete('/warehouses/:id', ensureAdmin, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const deleted = await warehouseService.removeWarehouse(req.params.id, session);
    if (!deleted) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Warehouse not found.' });
    }

    await session.commitTransaction();
    session.endSession();
    res.json({ message: 'Warehouse deleted successfully.' });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});


// ✅ GET WAREHOUSES BY MANAGER
router.get('/warehouses/manager/:managerId', ensureAdmin, async (req, res) => {
  try {
    const warehouses = await warehouseService.getWarehousesByManager(req.params.managerId);
    res.json(warehouses);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ✅ GET WAREHOUSES BY STATUS
router.get('/warehouses/status/:status', ensureAdmin, async (req, res) => {
  try {
    const warehouses = await warehouseService.getWarehousesByStatus(req.params.status);
    res.json(warehouses);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});



router.get('/manager/overview', ensureAuth, async (req, res) => {
  try {
    const user = req.session.user;

    if (user.role !== 'manager')
      return res.status(403).json({ message: 'Only managers can access this' });

    const data = await warehouseService.getManagerOverview(user.id);

    res.json(data);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});



// GET warehouse inventory (paginated)
router.get('/warehouse/inventory', ensureAuth, async (req, res) => {
  try {
    const user = req.session.user;

    // Only admins or warehouse managers can access
    if (!['admin', 'manager'].includes(user.role)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Find warehouse for this manager (admins can specify warehouseId later if needed)
    let warehouse;
    if (user.role === 'manager') {
      warehouse = await Warehouse.findOne({ managerId: user.id }).lean();
      if (!warehouse) return res.status(404).json({ message: 'No warehouse assigned' });
    }

    const query = {};
    if (user.role === 'manager') query.warehouseId = warehouse.id;

    const total = await WarehouseInventory.countDocuments(query);
    const products = await WarehouseInventory.find(query)
      .sort({ productName: 1 })
      .skip(skip)
      .limit(limit)
      .lean();

    res.json({
      warehouseId: warehouse?.id || null,
      products,
      page,
      totalPages: Math.ceil(total / limit),
      totalCount: total
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});



// GET /api/warehouse/sales
// GET /api/warehouse/sales
// GET /api/warehouse/sales
router.get('/warehouse/sales', async (req, res) => {
  try {
    const { warehouseId, page = 1, limit = 20, startDate, endDate } = req.query;
    if (!warehouseId) return res.status(400).json({ message: 'Missing warehouseId' });

    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 20;

    // 1️⃣ Get outlets under this warehouse
    const outlets = await Outlet.find({ warehouseId }).lean();
    console.log('WarehouseId:', warehouseId, 'Page:', pageNum, 'Limit:', limitNum); // ✅ here
    console.log('Found outlets:', outlets.length); // ✅ here

    const outletIds = outlets.map(o => o.id);

    // 2️⃣ Filter sales by outlets + optional date filter
 // 2️⃣ Filter sales by outlets + optional date filter
const filter = { outletId: { $in: outletIds } };

// always initialize createdAt only if needed
if ((startDate && startDate !== 'null') || (endDate && endDate !== 'null')) {
  filter.createdAt = {};
}

if (startDate && startDate !== 'null') {
  filter.createdAt.$gte = new Date(startDate);
}

if (endDate && endDate !== 'null') {
  filter.createdAt.$lte = new Date(endDate);
}


    // 3️⃣ Get paginated sales
    const sales = await Sale.find(filter)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean();

    console.log('Sales fetched:', sales.length); // ✅ here

    // 4️⃣ Enrich sales with outlet, product, and rep info
    const enriched = await Promise.all(
      sales.map(async (s) => {
        const outlet = outlets.find(o => o.id === s.outletId);
        const product = await Product.findOne({ id: s.productId });
        const seller = await Account.findOne({ id: s.soldBy });

        return {
          id: s.id,
          date: s.createdAt ? s.createdAt.toISOString().slice(0, 10) : '—', // safe
          outletName: outlet?.name || '—',
          productName: product?.name || '—',
          repName: seller?.name || '—',
          qty: s.qtySold,
          totalAmount: s.totalAmount,
        };
      })
    );

    const totalCount = await Sale.countDocuments(filter);

    res.json({ data: enriched, totalCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to load warehouse sales', error: err.message });
  }
});


module.exports = router;
