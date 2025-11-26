const Product = require('../models/Product');
const WarehouseInventory = require('../models/WarehouseInventory');
const OutletInventory = require('../models/OutletInventory');
const Company = require('../models/Company');




async function createProduct(data) {
  const product = new Product(data);
  return await product.save();
}

async function getAllProducts() {
  return await Product.find().sort({ createdAt: -1 });
}

async function getProductById(id) {
  return await Product.findOne({ id }); // Use your UUID field
}

async function updateProductById(id, updates, session) {
  updates.lastUpdated = new Date();
  return await Product.findOneAndUpdate({ id }, updates, { new: true, session });
}


async function removeProductById(id, session) {
  const deleted = await Product.findOneAndDelete({ id }, { session });
  if (!deleted) return null;
  await WarehouseInventory.deleteMany({ productId: id }, { session });
  await OutletInventory.deleteMany({ productId: id }, { session });
  await Company.updateOne(
    { id: deleted.companyId },
    { $inc: { totalProducts: -1 }, $set: { lastUpdated: new Date() } },
    { session }
  );

  return deleted;
}


async function getProductsByCompany(companyId) {
  return await Product.find({ companyId }).sort({ createdAt: -1 });
}


async function getProductBySKU(sku) {
  return await Product.findOne({ sku });
}


module.exports = {
  createProduct,
  getAllProducts,
  getProductById,
  updateProductById,
  removeProductById,
  getProductsByCompany,
  getProductBySKU
};
