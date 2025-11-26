const express = require('express');
const { v4: uuidv4 } = require('uuid');
const validator = require('validator');
const mongoose = require('mongoose');
const { ensureAuth, ensureAdmin } = require('../middlewares/auth');
const productService = require('../services/productServices');
const Product = require('../models/Product');
const Company = require('../models/Company');


const router = express.Router();

/// 🟢 CREATE PRODUCT (Admin only)
/// 🟢 CREATE PRODUCT (Admin only)
router.post('/products', ensureAdmin, async (req, res) => {

  
  try {
    let { sku, name, qty, companyId, companyName, unitPrice, status } = req.body;

    // Validate required fields
    if (!name || qty <= 0 || !companyId || !companyName || unitPrice <= 0)
      return res.status(400).json({ message: 'Missing required fields.' });

    // Sanitize inputs
    name = validator.escape(name.trim());
    companyName = validator.escape(companyName.trim());
    status = status ? validator.escape(status.trim()) : 'inStock';
    sku = sku ? validator.escape(sku.trim()) : uuidv4();

    // Validate numeric fields
    qty = Number(qty);
    unitPrice = parseFloat(unitPrice);
    if (isNaN(qty) || qty <= 0) return res.status(400).json({ message: 'Quantity must be a positive number.' });
    if (isNaN(unitPrice) || unitPrice <= 0) return res.status(400).json({ message: 'Unit price must be a positive number.' });

    // Check for duplicate SKU
    const existingProduct = await productService.getProductBySKU(sku);
    if (existingProduct) return res.status(400).json({ message: 'SKU already exists.' });

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

    const saved = await productService.createProduct(newProduct);
    res.status(201).json({ message: 'Product created successfully.', product: saved });

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
  }
);


  } catch (err) {
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
    const user = req.session.user;

    // Allow only admin or manager of this warehouse
    if (user.role !== 'admin') {
      const warehouse = await Warehouse.findOne({ id: warehouseId });
      if (!warehouse || warehouse.managerId !== user.id) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    const inventory = await WarehouseInventory.find({ warehouseId })
      .populate('productId', 'name sku unitPrice');

    const products = inventory.map(item => ({
      id: item.productId.id,
      sku: item.productId.sku,
      name: item.productId.name,
      unitPrice: item.productId.unitPrice,
      qty: item.qty
    })).filter(p => p.qty > 0); // only in-stock

    res.json(products);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
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




// 🔴 DELETE PRODUCT (Admin only)
// 🔴 DELETE PRODUCT (Admin only)
// 🔴 DELETE PRODUCT (Admin only)
router.delete('/products/:id', ensureAdmin, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // 1️⃣ Fetch product
    const product = await productService.getProductById(req.params.id, session);
    if (!product) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Product not found.' });
    }

    // 2️⃣ Fetch company
    const company = await Company.findOne({ id: product.companyId }).session(session);
    if (!company) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Company not found.' });
    }

    // 3️⃣ Prevent deletion if it would cause negative total stock
    if (product.qty > company.totalStock) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Cannot delete product: would cause negative total stock.' });
    }

    // 4️⃣ Prevent deletion if company has items in transit
    if (company.inTransit > 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Cannot delete product while items are in transit.' });
    }

    // 5️⃣ Delete product
    await productService.removeProductById(req.params.id, session);

    // 6️⃣ Update company totals
    await Company.updateOne(
      { id: product.companyId },
      {
        $pull: { products: { productId: product.id } },
        $inc: { totalProducts: -1, totalStock: -product.qty },
        $set: { lastUpdated: new Date() }
      },
      { session }
    );

    // 7️⃣ Commit transaction
    await session.commitTransaction();
    session.endSession();

    res.json({ message: 'Product deleted successfully.' });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('Delete product error:', err);
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



module.exports = router;
