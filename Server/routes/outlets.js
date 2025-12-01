const express = require('express');
const { v4: uuidv4 } = require('uuid');
const validator = require('validator');
const mongoose = require('mongoose');
const { ensureAuth, ensureAdmin, canCreateOutlet } = require('../middlewares/auth');
const Outlet = require('../models/Outlet');
const outletService = require('../services/outletService');
const warehouseService = require('../services/warehouseService');
const companyService = require('../services/companyService');
const OutletInventory = require('../models/OutletInventory');
const Sale = require('../models/Sale');
const Product = require('../models/Product'); 

const router = express.Router();


// ✅ CREATE OUTLET (Admin only)
router.post('/outlets', canCreateOutlet, async (req, res) => {
  console.log(req.body);

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    let { name, location, warehouseId, warehouseName, managerId, managerName, repId, repName, address, phone, status } = req.body;

    if (!name || !location || !warehouseId || !warehouseName)
      return res.status(400).json({ message: 'Missing required fields.' });

    // Sanitize
    name = validator.escape(name.trim());
    location = validator.escape(location.trim());
    warehouseName = validator.escape(warehouseName.trim());
    address = address ? validator.escape(address.trim()) : '';
    phone = phone ? validator.escape(phone.trim()) : '';
    status = status ? validator.escape(status.trim()) : 'active';

    const newOutlet = {
      id: uuidv4(),
      name,
      warehouseId,
      warehouseName,
      managerId: managerId || null,
      managerName: managerName || '',
      repId: repId || null,
      repName: repName || '',
      location,
      address,
      phone,
      status,
      totalStock: 0,
      totalProducts: 0,
      totalSales: 0,
      revenue: 0,
      createdAt: new Date(),
      lastUpdated: new Date()
    };

    // Perform all operations atomically
    const savedOutlet = await outletService.create(newOutlet, { session });
    await warehouseService.incrementTotalOutlets(warehouseId, session);
    await companyService.incrementTotalOutlets(session);

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({ message: 'Outlet created successfully.', outlet: savedOutlet });
  } catch (err) {
    console.error(err);
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});


// ✅ GET ALL OUTLETS (Admin only)
router.get('/outlets', ensureAdmin, async (req, res) => {
  try {
    const outlets = await outletService.getAll();
    res.json(outlets);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ✅ GET SINGLE OUTLET (Admin, Manager, or Rep)
router.get('/outlets/:id', ensureAuth, async (req, res) => {
  try {
    const outlet = await outletService.getById(req.params.id);
    if (!outlet) return res.status(404).json({ message: 'Outlet not found.' });

    const user = req.session.user;
    if (
      user.role !== 'admin' &&
      user.id !== outlet.managerId &&
      user.id !== outlet.repId
    ) return res.status(403).json({ message: 'Access denied.' });

    res.json(outlet);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});



// GET top outlets by stock OR revenue (default: stock)
router.get('/stats/top-outlets', ensureAdmin, async (req, res) => {
  try {
    const sortBy = req.query.sort === 'revenue' ? 'revenue' : 'totalStock'; 
    const limit = parseInt(req.query.limit) || 2;

    const top = await Outlet.find()
      .sort({ [sortBy]: -1 })
      .limit(limit)
      .select('name totalStock revenue location')
      .lean();

    res.json(top);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});


// ✅ UPDATE OUTLET (Admin, Manager)
router.put('/outlets/:id', ensureAuth, async (req, res) => {
  try {
    const outlet = await outletService.getById(req.params.id);
    if (!outlet) return res.status(404).json({ message: 'Outlet not found.' });

    const user = req.session.user;
    if (user.role !== 'admin' && user.id !== outlet.managerId)
      return res.status(403).json({ message: 'Access denied.' });

    const updates = req.body;
    updates.lastUpdated = new Date();

    const updatedOutlet = await outletService.update(req.params.id, updates);
    res.json({ message: 'Outlet updated successfully.', outlet: updatedOutlet });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});


// ✅ DELETE OUTLET (Admin only)
router.delete('/outlets/:id', ensureAdmin, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const outletId = req.params.id;

    // Delete outlet
    const deleted = await outletService.remove(outletId, session);
    if (!deleted) throw new Error('Outlet not found.');

    // Delete outlet inventory
    await OutletInventory.deleteMany({ outletId }, { session });

    // Update warehouse and company counts
    await warehouseService.decrementTotalOutlets(deleted.warehouseId, session);
    await companyService.decrementTotalOutlets(session);

    await session.commitTransaction();
    session.endSession();

    res.json({ message: 'Outlet deleted successfully.' });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ✅ GET OUTLETS BY WAREHOUSE
router.get('/outlets/warehouse/:warehouseId', ensureAuth, async (req, res) => {
  try {
    const user = req.session.user;
    const warehouseId = req.params.warehouseId;

    // Allow admin OR manager of this warehouse
    if (user.role !== 'admin') {
      const warehouse = await warehouseService.getWarehouseById(warehouseId);
      if (!warehouse || warehouse.managerId !== user.id) {
        return res.status(403).json({ message: 'Access denied.' });
      }
    }

    const outlets = await outletService.getByWarehouse(warehouseId);
    res.json(outlets);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ GET OUTLETS BY MANAGER
router.get('/outlets/manager/:managerId', ensureAuth, async (req, res) => {
  try {
    const outlets = await outletService.getByManager(req.params.managerId);
    res.json(outlets);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ✅ GET OUTLETS BY REP
router.get('/outlets/rep/:repId', ensureAuth, async (req, res) => {
  try {
    const outlets = await outletService.getByRep(req.params.repId);
    res.json(outlets);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});


router.get('/outlet/overview', ensureAuth, async (req, res) => {
  try {
    const user = req.session.user;

    if (user.role !== 'rep' && user.role !== 'admin')
      return res.status(403).json({ message: 'Only outlet reps can access this' });

    const data = await outletService.getOutletOverview(user.id);

    res.json(data);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});



router.get('/outlet/inventory', ensureAuth, async (req, res) => {
  try {
    const user = req.session.user;

    // Only reps should access this route
    if (user.role !== 'rep') {
      return res.status(403).json({ message: 'Only outlet reps can access this' });
    }

    // Find the outlet assigned to this rep
    const outlet = await Outlet.findOne({ repId: user.id }).lean();

    if (!outlet) {
      return res.status(404).json({ message: 'No outlet assigned to this rep' });
    }

    // Fetch full inventory for this rep’s outlet
   // Fetch inventory for outlet with product price
const items = await OutletInventory.find({ outletId: outlet.id }).lean();

const enriched = await Promise.all(
  items.map(async (inv) => {
    const product = await Product.findOne({ id: inv.productId }).lean();
    return {
      ...inv,
      price: product?.unitPrice || 0
    };
  })
);

res.json({
  outletId: outlet.id,
  products: enriched,
  count: enriched.length
});


  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});


router.get('/outlet/sales', async (req, res) => {
  try {
    const { page = 1, limit = 20, startDate, endDate, outletId } = req.query;
    if (!outletId) return res.status(400).json({ message: 'Outlet ID required' });

    const filter = { outletId };
    if (startDate || endDate) filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate) filter.createdAt.$lte = new Date(endDate);

    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 20;

    // Group sales by createdAt timestamp (same second = same transaction)
    const rawSales = await Sale.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    const groupedSales = [];
    const seen = new Set();

    for (const sale of rawSales) {
      const timeKey = sale.createdAt.toISOString().slice(0, 19); // up to seconds
      if (seen.has(timeKey)) continue;
      seen.add(timeKey);

      const itemsInSale = rawSales.filter(s => 
        s.createdAt.toISOString().slice(0, 19) === timeKey
      );

      const totalAmount = itemsInSale.reduce((sum, s) => sum + s.totalAmount, 0);
      const totalQty = itemsInSale.reduce((sum, s) => sum + s.qtySold, 0);

      groupedSales.push({
        id: sale.id + '-group', // unique
        date: new Date(sale.createdAt).toISOString().slice(0, 10),
        time: new Date(sale.createdAt).toTimeString().slice(0, 8),
        items: itemsInSale.map(s => ({
          productId: s.productId,
          productName: '—', 
          qty: s.qtySold,
          amount: s.totalAmount
        })),
        totalQty,
        totalAmount,
        itemCount: itemsInSale.length
      });
    }

    // Enrich product names
 for (const group of groupedSales) {
  for (const item of group.items) {
    const saleRecord = itemsInSale.find(s => s.productId === item.productId);
    const prod = await Product.findOne({ id: item.productId }).lean();
    
    item.productName = prod?.name || '—';
    item.unitPrice = prod?.unitPrice || 0;  
  }
}

    const start = (pageNum - 1) * limitNum;
    const paginated = groupedSales.slice(start, start + limitNum);

    res.json({
      data: paginated,
      totalCount: groupedSales.length
    });

  } catch (err) {
    res.status(500).json({ message: 'Error', error: err.message });
  }
});

// GET /api/outlet/sales
/*router.get('/outlet/sales', async (req, res) => {
   console.log("Incoming /outlet/sales request:", req.query, req.session.user);
  
  try {
    const { page = 1, limit = 20, startDate, endDate, outletId  } = req.query;
    if (!outletId) return res.status(400).json({ message: 'Outlet ID required' });

    const repId = req.session.user?.id;               // the logged-in rep
    if (!repId || req.session.user?.role !== 'rep') 
      return res.status(400).json({ message: 'Login as rep required' });

    // 1️⃣ Filter sales by this outlet + optional date filter
const filter = { outletId: outletId };
if (startDate || endDate) filter.createdAt = {};
if (startDate) filter.createdAt.$gte = new Date(startDate);
if (endDate) filter.createdAt.$lte = new Date(endDate);

const pageNumber = Number(page) || 1;
const limitNumber = Number(limit) || 20;

    // 2️⃣ Get paginated sales
    const sales = await Sale.find(filter)
      .sort({ createdAt: -1 })
      .skip((pageNumber  - 1) * limit)
      .limit(limitNumber)
      .lean();

    // 3️⃣ Enrich sales with product info
   const enriched = await Promise.all(
  sales.map(async (s) => {
    let productName = '—';
    try {
      const product = await Product.findOne({ id: s.productId }).lean();
      if (product?.name) productName = product.name;
    } catch (e) {
      console.error('Product lookup failed:', s.productId);
    }

    return {
      id: s.id,
      date: s.createdAt ? new Date(s.createdAt).toISOString().slice(0, 10) : '—',
      productName,
      qty: s.qtySold || 0,
      totalAmount: s.totalAmount || 0,
    };
  })
);

    // 4️⃣ Count total for pagination
    const totalCount = await Sale.countDocuments(filter);

    res.json({ data: enriched, totalCount });
  } catch (err) {
     console.log("Incoming /outlet/sales request:", req.query, req.session.user);
    res.status(500).json({ message: 'Failed to load outlet sales', error: err.message });
  }
}); */



module.exports = router;
