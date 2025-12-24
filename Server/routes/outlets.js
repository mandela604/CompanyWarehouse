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
const Warehouse = require('../models/Warehouse');
const Account = require('../models/Account');

const router = express.Router();


// ✅ CREATE OUTLET (Admin only)
router.post('/outlets', canCreateOutlet, async (req, res) => {
  console.log(req.body);

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    let { name, location, warehouseId, warehouseName, managerId, managerName, repIds = [],       // new: array
  repNames = [],address, phone, status } = req.body;

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
      repIds: Array.isArray(repIds) ? repIds : [],
      repNames: Array.isArray(repNames) ? repNames : [],
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


router.post('/select-outlet', ensureAuth, (req, res) => {
  const { outletId } = req.body;
  if (!req.session.outlets?.some(o => o.id === outletId)) {
    return res.status(403).json({ message: 'Invalid outlet' });
  }
  req.session.currentOutletId = outletId;

  req.session.save(err => {
    if (err) return res.status(500).json({ error: 'Session save failed' });
    res.json({ success: true });
  });
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
router.get('/outlet', ensureAuth, async (req, res) => {
  const { page = 1, limit = 10, outletId } = req.query;
  const user = req.session.user;

  let finalOutletId = outletId?.trim();

  // Rep: use session outlet
  if (user.role === 'rep') {
    finalOutletId = req.session.currentOutletId || user.currentOutletId;
    if (!finalOutletId) return res.status(403).json({ message: 'No outlet selected' });
  }

  // Admin/Manager: require outletId param
  if ((user.role === 'admin' || user.role === 'manager') && !finalOutletId) {
    return res.status(400).json({ message: 'outletId required' });
  }

  try {
    const skip = (page - 1) * Number(limit);

    const shipments = await Shipment.find({
      'to.id': finalOutletId,
      toType: 'Outlet'
    })
      .sort({ date: -1 })  // use 'date' field like other routes
      .skip(skip)
      .limit(Number(limit))
      .lean();

    const totalCount = await Shipment.countDocuments({
      'to.id': finalOutletId,
      toType: 'Outlet'
    });

    const enriched = shipments.map(s => ({
      id: s.id || s.id,
      date: s.date,
      fromName: s.from?.name || 'Warehouse',
      status: s.status,
      products: s.products.map(p => ({
        name: p.name || p.productName || 'Unknown Product',
        qty: p.qty,
        unitPrice: p.unitPrice || 0   // ← essential for Total Value
      }))
    }));

    res.json({ shipments: enriched, totalCount, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error('Outlet shipments error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/outlets/:id — used by admin dashboard to edit outlet
router.get('/outlets/:id', ensureAuth, async (req, res) => {
  try {
    const outletId = req.params.id?.trim();
    if (!outletId) return res.status(400).json({ message: 'Outlet ID required' });

    const outlet = await Outlet.findOne({ id: outletId }).lean();
    if (!outlet) return res.status(404).json({ message: 'Outlet not found' });

    const user = req.session.user;

    // Same permission logic you already trust
    if (user.role === 'rep') {
      if (outlet.repId !== user.id) return res.status(403).json({ message: 'Access denied' });
    } else if (user.role === 'manager') {
      const warehouse = await Warehouse.findOne({ id: outlet.warehouseId, managerId: user.id }).lean();
      if (!warehouse) return res.status(403).json({ message: 'Access denied' });
    }
    // admin can see all

    res.json(outlet);
  } catch (err) {
    console.error('GET /outlets/:id error:', err);
    res.status(500).json({ message: 'Server error' });
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
    let outletId = req.query.outletId?.trim();

    // REPS: MUST use session currentOutletId — ignore whatever they send in URL
    if (user.role === 'rep') {
      outletId = req.session.currentOutletId;
      if (!outletId) {
        return res.status(403).json({ message: 'No outlet selected in session' });
      }
    }
    // ADMIN/MANAGER: require outletId in query
    else if (user.role === 'manager' || user.role === 'admin') {
      if (!outletId) {
        return res.status(400).json({ message: 'outletId required' });
      }
    } else {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    // Now find outlet by your custom 'id' field (not _id)
    const outlet = await Outlet.findOne({ id: outletId }).lean();
    if (!outlet) return res.status(404).json({ message: 'Outlet not found' });

    // Manager extra check
    if (user.role === 'manager') {
      const warehouse = await Warehouse.findOne({ managerId: user.id }).lean();
      if (!warehouse || outlet.warehouseId !== warehouse.id) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    const data = await outletService.getOutletOverview(outletId);
    res.json(data);

  } catch (err) {
    console.error('Overview error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/*router.get('/outlet/overview', ensureAuth, async (req, res) => {
  try {
    const user = req.session.user;

    if (user.role !== 'rep' && user.role !== 'admin')
      return res.status(403).json({ message: 'Only outlet reps can access this' });

    const data = await outletService.getOutletOverview(user.id);

    res.json(data);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});*/



// GET /api/outlet/inventory
// → Reps: no query param needed
// → Manager/Admin: ?outletId=xxx required
router.get('/outlet/inventory', ensureAuth, async (req, res) => {
  try {
    const user = req.session.user;
    let outletId = req.query.outletId?.trim();

    console.log('outletid:', outletId );
    // === CASE 1: User is a Rep → auto-resolve their own outlet
    if (user.role === 'rep') {
      if (outletId) {
        // Optional: Reps can also view another outlet if explicitly given AND it's theirs
        const requestedOutlet = await Outlet.findOne({ id: outletId }).lean();
        if (!requestedOutlet || requestedOutlet.repId !== user.id) {
          return res.status(403).json({ message: 'You can only view your own outlet' });
        }
        // It's valid → proceed with requested one
      } else {
        // No outletId provided → find the one assigned to this rep
        const ownOutlet = await Outlet.findOne({ repId: user.id }).lean();
        if (!ownOutlet) {
          return res.status(404).json({ message: 'No outlet assigned to you' });
        }
        outletId = ownOutlet.id;
      }
    }

    // === CASE 2: Manager or Admin → outletId is REQUIRED
    else if (user.role === 'manager' || user.role === 'admin') {
      if (!outletId) {
        return res.status(400).json({ message: 'outletId query parameter is required' });
      }
    }

    // === Invalid role
    else {
      return res.status(403).json({ message: 'Unauthorized access' });
    }

    // === Now fetch the outlet (we have a valid outletId at this point)
    const outlet = await Outlet.findOne({ id: outletId }).lean();
    if (!outlet) {
      return res.status(404).json({ message: 'Outlet not found' });
    }

    // === Final permission check (extra safety for managers/admins)
    const allowed =
      user.role === 'admin' ||
      user.role === 'manager' ||
      (user.role === 'rep' && outlet.repId === user.id);

    if (!allowed) {
      return res.status(403).json({ message: 'You do not have access to this outlet' });
    }

    // === Fetch inventory
    const items = await OutletInventory.find({ outletId: outlet.id }).lean();

    const enriched = await Promise.all(
      items.map(async (inv) => {
        const product = await Product.findOne({ id: inv.productId }).lean();
        return {
          ...inv,
          productName: product?.name || 'Unknown Product',
          price: product?.unitPrice || 0,
          unitPrice: product?.unitPrice || 0,
        };
      })
    );

    // === Success response
    res.json({
      outletId: outlet.id,
      outletName: outlet.name,
      location: outlet.location,
      products: enriched,
      count: enriched.length,
    });

  } catch (err) {
    console.error('Error in /outlet/inventory:', err);
    res.status(500).json({ message: 'Server error' });
  }
}); 


/*router.get('/outlet/inventory', ensureAuth, async (req, res) => {
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
  outletName: outlet.name,       
  location: outlet.location,
  products: enriched,
  count: enriched.length
});


  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});*/


router.get('/outlet/sales', async (req, res) => {
  try {
    const { page = 1, limit = 20, startDate, endDate, outletId } = req.query;
    if (!outletId) return res.status(400).json({ message: 'Outlet ID required' });

    const filter = { outletId };
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate + 'T23:59:59.999Z');
    }

    const rawSales = await Sale.find(filter).sort({ createdAt: -1 }).lean();
    if (rawSales.length === 0) return res.json({ data: [], totalCount: 0 });

    // Fetch products
    const productIds = [...new Set(rawSales.map(s => s.productId))];
    console.log('rawSales productIds:', productIds);
    const products = await Product.find({ id: { $in: productIds } }).lean();
    console.log('Sample productIds from sales:', productIds.slice(0, 3));
console.log('Sample products found:', products.map(p => ({ id: p.id, _id: p._id, name: p.name })));
    const productMap = Object.fromEntries(products.map(p => [p.id, { name: p.name, unitPrice: p.unitPrice }]));

    // Fetch sellers
    const sellerIds = [...new Set(rawSales.map(s => s.soldBy))];
    const sellers = await Account.find({ id: { $in: sellerIds } }).lean();
    const sellerMap = Object.fromEntries(sellers.map(s => [s.id, s]));

    // Group by transactionId
    const groups = {};
    for (const sale of rawSales) {
      const key = sale.transactionId || sale.createdAt.toISOString().slice(0, 19);
      if (!groups[key]) groups[key] = [];
      groups[key].push(sale);
    }

    const groupedSales = Object.values(groups).map(itemsInSale => {
      const sample = itemsInSale[0];
      const totalAmount = itemsInSale.reduce((sum, s) => sum + s.totalAmount, 0);
      const totalQty = itemsInSale.reduce((sum, s) => sum + s.qtySold, 0);

      return {
        transactionId: sample.transactionId || null,
        id: (sample.transactionId || sample.id) + '-group',
        date: new Date(sample.createdAt).toISOString().slice(0, 10),
        time: new Date(sample.createdAt).toTimeString().slice(0, 8),
        repName: sellerMap[sample.soldBy]?.name || '—',   // <-- added repName
        items: itemsInSale.map(s => ({
          productId: s.productId,
          productName: productMap[s.productId]?.name || '—',
          unitPrice: productMap[s.productId]?.unitPrice || 0,
          qty: s.qtySold,
          amount: s.totalAmount
        })),
        totalQty,
        totalAmount,
        itemCount: itemsInSale.length
      };
    });

    // Pagination
    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 20;
    const start = (pageNum - 1) * limitNum;
    const paginated = groupedSales.slice(start, start + limitNum);

    res.json({
      data: paginated,
      totalCount: groupedSales.length
    });

  } catch (err) {
    console.error('Error in /outlet/sales:', err);
   console.error(err.stack); 
    res.status(500).json({ message: 'Server error', error: err.message });
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
