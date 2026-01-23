const express = require('express');
const { v4: uuidv4 } = require('uuid');
const validator = require('validator');
const mongoose = require('mongoose');
const { ensureAuth, ensureAdmin } = require('../middlewares/auth');
const productService = require('../services/productServices');
const Product = require('../models/Product');
const Company = require('../models/Company');
const Warehouse = require('../models/Warehouse');
const WarehouseInventory = require('../models/WarehouseInventory');
const Sale = require('../models/Sale');
const Shipment = require('../models/Shipment');
const OutletInventory = require('../models/OutletInventory');
const Outlet = require('../models/Outlet');
const RestockLog = require('../models/RestockLog');

const router = express.Router();


// GET /api/products/report
router.get('/products/report-v2', ensureAdmin, async (req, res) => {
 console.log("REPORT V2 WAS HIT!", req.query);
  try {
    const {
      page = 1,
      limit = 15,
      startDate,
      endDate,
      warehouseId,
      outletId
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // 1. Build filter for sales (date + outlet)
    const salesFilter = {};
    if (startDate || endDate) {
      salesFilter.createdAt = {};
      if (startDate) salesFilter.createdAt.$gte = new Date(startDate);
      if (endDate)   salesFilter.createdAt.$lte = new Date(`${endDate}T23:59:59.999Z`);
    }
    if (outletId) salesFilter.outletId = outletId;

    // 2. Aggregate total sold + revenue **per product**
    const salesAgg = await Sale.aggregate([
      { $match: salesFilter },
      {
        $group: {
          _id: '$productId',               // group by productId (uuid string)
          totalSold: { $sum: '$qtySold' },
          revenue:   { $sum: '$totalAmount' }
        }
      }
    ]);

    // Map for fast lookup: productId → {totalSold, revenue}
    const salesMap = new Map(salesAgg.map(s => [s._id, s]));

    // 3. Get paginated products
    const productQuery = {};
    // If you later add warehouse filtering (e.g. via WarehouseInventory), add here
    // if (warehouseId) productQuery.warehouseId = warehouseId; // not present yet

    const products = await Product.find(productQuery)
      .skip(skip)
      .limit(parseInt(limit))
      .select('id sku name qty unitPrice') // minimal fields
      .lean();

    const totalCount = await Product.countDocuments(productQuery);

    // 4. Enrich with sales data
    const enriched = products.map(p => {
      const sales = salesMap.get(p.id) || { totalSold: 0, revenue: 0 };
      return {
        id:            p.id,
        sku:           p.sku,
        name:          p.name,
        totalSold:     sales.totalSold,
        revenue:       sales.revenue,
        currentStock:  p.qty || 0,
        unitsReceived: p.qty || 0   // fallback — you don't track received separately yet
      };
    });

    // 5. Summary stats
    const summary = {
      totalSold:     salesAgg.reduce((sum, s) => sum + s.totalSold, 0),
      totalRevenue:  salesAgg.reduce((sum, s) => sum + s.revenue,   0),
      totalProducts: await Product.countDocuments({}),
      zeroSaleProducts: await Product.countDocuments({
        id: { $nin: salesAgg.map(s => s._id) }
      })
    };

    res.json({
      products: enriched,
      totalCount,
      summary
    });

  } catch (err) {
    console.error('Product report error:', err);
    res.status(500).json({ message: 'Failed to generate report', error: err.message });
  }
});


/// 🟢 CREATE PRODUCT (Admin only)
/// 🟢 CREATE PRODUCT (Admin only)
router.post('/products', ensureAdmin, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    let { sku, name, qty, companyId, companyName, unitPrice, status } = req.body;

    if (!name || qty <= 0 || !companyId || !companyName || unitPrice <= 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Missing required fields.' });
    }

    name = validator.escape(name.trim());
    companyName = validator.escape(companyName.trim());
    status = status ? validator.escape(status.trim()) : 'inStock';
    sku = sku ? validator.escape(sku.trim()) : uuidv4();

    qty = Number(qty);
    unitPrice = parseFloat(unitPrice);

    if (isNaN(qty) || qty <= 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Quantity must be a positive number.' });
    }

    if (isNaN(unitPrice) || unitPrice <= 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Unit price must be a positive number.' });
    }

    const existingProduct = await Product.findOne({ sku }).session(session);
    if (existingProduct) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'SKU already exists.' });
    }

    const id = uuidv4();

    const newProduct = {
      id,
      sku,
      name,
      qty,
      companyId,
      companyName,
      unitPrice,
      status,
      createdAt: new Date(),
      lastUpdated: new Date()
    };

    const saved = await Product.create([newProduct], { session });

    await Company.findOneAndUpdate(
      {},
      {
        $push: {
          products: {
            productId: newProduct.id,
            productSku: newProduct.sku,
            name: newProduct.name,
            unitPrice: newProduct.unitPrice,
            qty: newProduct.qty
          }
        },
        $inc: {
          totalProducts: 1,
          totalStock: newProduct.qty
        },
        $set: { lastUpdated: new Date() }
      },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      message: 'Product created successfully.',
      product: saved[0]
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('Create product error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});




// 🔵 GET ALL PRODUCT
router.get('/products', ensureAuth, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  const products = await Product.find().skip(skip).limit(limit);
  const total = await Product.countDocuments();

  res.json({ products, total, page, totalPages: Math.ceil(total / limit) });
});


// 🔵 GET SINGLE PRODUCT (Admin, Manager, or Rep)
router.get('/products/:id', ensureAuth, async (req, res) => {
  try {
    const product = await productService.getProductById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found.' });

    const user = req.session.user;
    if (!['admin', 'manager', 'rep'].includes(user.role))
      return res.status(403).json({ message: 'Access denied.' });

    res.json(product);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});




// GET PRODUCTS IN WAREHOUSE STOCK (for manager shipping)
router.get('/products/warehouse/:warehouseId', ensureAuth, async (req, res) => {
  try {
    const { warehouseId } = req.params;
    console.log('warehouse:', warehouseId);
    const user = req.session.user;

    // Allow only admin or manager of this warehouse
    if (user.role !== 'admin') {
      const warehouse = await Warehouse.findOne({ id: warehouseId });
      if (!warehouse || warehouse.managerId !== user.id) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

  const inventory = await WarehouseInventory.find({ warehouseId });
   const products = inventory.map(item => ({
  id: item.productId,
  sku: item.sku,
  name: item.productName,
  unitPrice: item.unitPrice,
  qty: item.qty
})).filter(p => p.qty > 0);

  console.log('Products fetched:', products); 
  res.json(products);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
        console.error('server error:',  err);
  }
});



// 🟣 UPDATE PRODUCT (Admin only)
router.put('/products/:id', ensureAdmin, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const updates = req.body;

    if (typeof updates.qty !== 'number' || updates.qty < 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Quantity must be a non-negative number.' });
    }

    // 1️⃣ Fetch current product
    const oldProduct = await productService.getProductById(req.params.id, session);
    if (!oldProduct) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Product not found.' });
    }

/*const company = await Company.findOne({ id: oldProduct.companyId }).session(session);

if (company.inTransit > 0) {
  await session.abortTransaction();
  session.endSession();
  return res.status(400).json({ message: 'Cannot update any product while there are items in transit.' });
} */



    // 2️⃣ Update product
    const updated = await productService.updateProductById(req.params.id, updates, session);

    // 3️⃣ Calculate quantity difference
    const qtyDiff = updates.qty - oldProduct.qty;

    // 4️⃣ Update company totals and product snapshot
    await Company.updateOne(
      { id: oldProduct.companyId },
      {
        $inc: { totalStock: qtyDiff },
        $set: {
          'products.$[p].qty': updates.qty,
          'products.$[p].name': updates.name || oldProduct.name,
          'products.$[p].unitPrice': updates.unitPrice || oldProduct.unitPrice,
          lastUpdated: new Date()
        }
      },
      { arrayFilters: [{ 'p.productId': oldProduct.id }], session }
    );

    await session.commitTransaction();
    session.endSession();

    res.json({ message: 'Product updated successfully.', product: updated });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('Update product error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// POST /api/products/:id/restock
router.post('/products/:id/restock', ensureAdmin, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { addedQty } = req.body;
    if (!Number.isInteger(addedQty) || addedQty < 1) {
      return res.status(400).json({ message: 'Added quantity must be a positive integer' });
    }

    const product = await Product.findOne({ id: req.params.id }).session(session);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    // Log the restock
    await RestockLog.create([{
      productId: product.id,
      productName: product.name,
      addedQty,
      restockedBy: req.session.user.name || 'Admin',
      restockedById: req.session.user.id || null,
      date: new Date()
    }], { session });

    // Update qty
    product.qty += addedQty;
    product.lastUpdated = new Date();
    await product.save({ session });

    // Update company total
    await Company.updateOne(
      { id: product.companyId },
      { $inc: { totalStock: addedQty } },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    res.json({ success: true, newQty: product.qty, added: addedQty });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ message: err.message || 'Restock failed' });
  }
});

// GET /api/products/:id/restocks
router.get('/products/:id/restocks', ensureAuth, async (req, res) => {
  try {
    const logs = await RestockLog.find({ productId: req.params.id })
      .sort({ date: -1 })     // newest first
      .lean();                // faster, plain JS objects

    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: 'Failed to load history' });
  }
});


// 🔴 DELETE PRODUCT (Admin only)
// 🔴 DELETE PRODUCT (Admin only)
// 🔴 DELETE PRODUCT (Admin only)
// 🔴 DELETE PRODUCT (Admin only) - TRUE FORCE CASCADE (Deletes EVERYTHING, no checks except product exists)
router.delete('/products/:id', ensureAdmin, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const productId = req.params.id;

    // Get product
    const product = await productService.getProductById(productId, session);
    if (!product) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Product not found.' });
    }

   // --- OUTLET INVENTORY ---
const outletInventories = await OutletInventory.find({ productId }).session(session);
let outletQty = 0;
for (const ol of outletInventories) {
  outletQty += ol.qty;
  await Outlet.updateOne(
    { id: ol.outletId },
    { 
      $inc: { totalStock: -ol.qty, revenue: -ol.revenue },
      $set: { lastUpdated: new Date() }
    },
    { session }
  );
}
await OutletInventory.deleteMany({ productId }, { session });

// --- WAREHOUSE INVENTORY ---
const warehouseInventories = await WarehouseInventory.find({ productId }).session(session);
let warehouseQty = 0;
for (const wh of warehouseInventories) {
  warehouseQty += wh.qty;
  await Warehouse.updateOne(
    { id: wh.warehouseId },
    { 
      $inc: { totalStock: -wh.qty, totalRevenue: -wh.revenue },
      $set: { lastUpdated: new Date() }
    },
    { session }
  );
}
await WarehouseInventory.deleteMany({ productId }, { session });

// --- COMPANY ---
const totalQtyToRemove = (product.qty || 0) + outletQty + warehouseQty;
await Company.updateOne(
  { id: product.companyId },
  {
    $pull: { products: { productId } },
    $inc: { totalProducts: -1, totalStock: -totalQtyToRemove },
    $set: { lastUpdated: new Date() }
  },
  { session }
);

    // --- SALES ---
    await Sale.deleteMany({ productId }, { session });

    // --- SHIPMENTS ---
    await Shipment.updateMany(
      { 'products.productId': productId },
      { $pull: { products: { productId } } },
      { session }
    );
    await Shipment.deleteMany(
      { products: { $exists: true, $eq: [] } },
      { session }
    );

  

    // Delete the product itself
    await productService.removeProductById(productId, session);

    await session.commitTransaction();
    session.endSession();

    res.json({ 
      message: 'Product completely deleted — inventory and revenue adjusted for company, warehouse, and outlet.' 
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('Force cascade delete error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});







// 🟠 GET PRODUCTS BY COMPANY (Admin only)
 router.get('/products/company/:companyId', ensureAdmin, async (req, res) => {
  try {
    const products = await productService.getProductsByCompany(req.params.companyId);
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});  


// 🔵 GET PRODUCTS IN COMPANY STOCK (for shipping)
router.get('/products/company', ensureAuth, async (req, res) => {
 console.log('hit /products/company')
  try {
    const company = await Company.findOne(); // single company
    if (!company) return res.status(404).json({ message: 'Company not found.' });
    console.log('Company products from DB:', company.products);
    
    // only return products with qty > 0
    const products = (company.products || []).filter(p => p.qty > 0);

    res.json(products);
  } catch (err) {
    console.error('Fetch company products error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});



// 🟢 GET OUTLET INVENTORY (Rep or Manager)
router.get('/outlet/:outletId/inventory', ensureAuth, async (req, res) => {
  try {
    const user = req.session.user;
    const { outletId } = req.params;

    // Reps can only view their own outlet
    if (user.role === 'rep' && user.manages[0] !== outletId)
      return res.status(403).json({ message: 'Access denied: not your outlet.' });

    // Managers can see outlets under their warehouse — you'd verify that here if needed

    // Fetch outlet inventory
    const inventory = await OutletInventory.find({ outletId }).populate('productId'); 
    // (Assuming you have an OutletInventory model that links outletId + productId + qty)

    res.json(inventory);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});



// GET /api/products/:id/details
// GET /api/products/:id/details
router.get('/products/:id/details', ensureAdmin, async (req, res) => {
  try {
    const product = await Product.findOne({ id: req.params.id }).lean();
    if (!product) return res.status(404).json({ message: 'Product not found' });

    const sales = await Sale.aggregate([
      { $match: { productId: product.id } },
      {
        $group: {
          _id: null,
          totalSold: { $sum: '$qtySold' },
          revenue:   { $sum: '$totalAmount' }
        }
      }
    ]);

    res.json({
      totalSold:    sales[0]?.totalSold  || 0,
      revenue:      sales[0]?.revenue    || 0,
      currentStock: product.qty || 0,
      unitsReceived: product.qty || 0   // fallback — add real tracking later if needed
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
