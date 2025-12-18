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

async function getProductById(id, session) {
  return await Product.findOne({ id }).session(session);
}


async function updateProductById(id, updates, session) {
  updates.lastUpdated = new Date();
  return await Product.findOneAndUpdate({ id }, updates, { new: true, session });
}


async function removeProductById(id, session) {
  return await Product.findOneAndDelete({ id }, { session });
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
