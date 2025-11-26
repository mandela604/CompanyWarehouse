const Outlet = require('../models/Outlet');
const OutletInventory = require('../models/OutletInventory');
const Sale = require('../models/Sale');
const Shipment = require('../models/Shipment');
const Inventory = require('../models/OutletInventory'); // if you have this
const Product = require('../models/Product'); // for names
const Account = require('../models/Account');


// Create new outlet
async function create(data) {
  const outlet = new Outlet(data);
  return await outlet.save();
}

// Get all outlets
async function getAll() {
  const outlets = await Outlet.find().sort({ createdAt: -1 });

  return Promise.all(outlets.map(async o => {
    if (o.repId) {
      const rep = await Account.findOne({ id: o.repId });
      if (rep) {
        o.repName = rep.name;
        o.phone = rep.phone; // add phone here
      } else {
        o.repName = null;
        o.phone = null;
      }
    }
    return o;
  }));
}


// Get single outlet by ID
async function getById(id) {
  return await Outlet.findOne({ id });
}

// Update outlet
async function update(id, updates) {
  return await Outlet.findOneAndUpdate({ id }, updates, { new: true });
}

// Delete outlet and its inventory
async function remove(id, session) {
  const deleted = await Outlet.findOneAndDelete({ id }, { session });
  if (!deleted) return null;
  await OutletInventory.deleteMany({ outletId: id }, { session });
  return deleted;
}


// Get outlets by warehouse
async function getByWarehouse(warehouseId) {
  const outlets = await Outlet.find({ warehouseId });

  return Promise.all(outlets.map(async o => {
    if (o.repId) {
      const rep = await Account.findOne({ id: o.repId });
      if (rep) {
        o.repName = rep.name;
        o.phone = rep.phone;
      } else {
        o.repName = null;
        o.phone = null;
      }
    }
    return o;
  }));
}


// Get outlets by manager
async function getByManager(managerId) {
  return await Outlet.find({ managerId });
}

// Get outlets by rep
async function getByRep(repId) {
  return await Outlet.find({ repId });
}


async function getOutletOverview(repId) {
  // 1️⃣ Find the outlet assigned to this rep
  const outlet = await Outlet.findOne({ repId }).lean();
  if (!outlet) return null;

  // 2️⃣ Today’s sales
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todaysSales = await Sale.find({
    outletId: outlet.id,
    createdAt: { $gte: today },
    isReversal: false
  }).lean();

  const todaySalesTotal = todaysSales.reduce((sum, s) => sum + s.totalAmount, 0);

  // 3️⃣ Incoming shipments for this outlet
  const incomingShipments = await Shipment.countDocuments({
    'to.id': outlet.id,
    toType: 'Outlet',
    status: { $in: ['In Transit', 'Pending'] } 
  }); 

  // 4️⃣ Quick inventory summary (first 6 products)
  const inventoryList = await Inventory.find({ outletId: outlet.id })
    .sort({ qty: -1 })
    .limit(6)
    .lean();

  const quickInventory = [];

  for (const item of inventoryList) {
    const product = await Product.findOne({ id: item.productId }).lean();
    quickInventory.push({
      name: product?.name || '—',
      qty: item.qty,
      price: item.price
    });
  }

  // 5️⃣ Recent sales (latest 5)
  const recentSalesList = await Sale.find({
    outletId: outlet.id,
    isReversal: false
  })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  const recentSales = [];

  for (const s of recentSalesList) {
    const prod = await Product.findOne({ id: s.productId }).lean();
    recentSales.push({
      date: s.createdAt.toISOString().slice(0, 10),
      product: prod?.name || '—',
      qty: s.qtySold,
      amount: s.totalAmount
    });
  }

  // 6️⃣ Response for frontend
  return {
    outletStock: outlet.totalStock,
    todaySales: todaySalesTotal,
    totalRevenue: outlet.revenue,
    incomingShipments,

    quickInventory,
    recentSales
  };
}


module.exports = {
  create,
  getAll,
  getById,
  update,
  remove,
  getByWarehouse,
  getByManager,
  getByRep,
  getOutletOverview
};
