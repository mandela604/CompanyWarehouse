const Company = require('../models/Company');
const Warehouse = require('../models/Warehouse');
const WarehouseInventory = require('../models/WarehouseInventory');
const Shipment = require('../models/Shipment');
const Account = require('../models/Account');
const Outlet = require('../models/Outlet');


// CREATE
async function createWarehouse(data) {
  const warehouse = new Warehouse(data);
  const saved = await warehouse.save();
  await Company.updateOne({}, { $inc: { totalWarehouses: 1 } }); // add +1
  return saved;
}

// GET ALL
async function getAllWarehouses() {
  const warehouses = await Warehouse.find().sort({ createdAt: -1 });

  return Promise.all(warehouses.map(async w => {
    if (w.managerId) {
      const manager = await Account.findOne({ id: w.managerId });
      w.manager = manager ? manager.name : null;
    }
    return w;
  }));
}


// GET BY ID
async function getWarehouseById(id) {
  return await Warehouse.findOne({ id });
}

// UPDATE
async function updateWarehouse(id, updates) {
  updates.lastUpdated = new Date();
  return await Warehouse.findOneAndUpdate({ id }, updates, { new: true });
}

// DELETE warehouse
async function removeWarehouse(id, session) {
  const deleted = await Warehouse.findOneAndDelete({ id }, { session });
  if (!deleted) return null;

  await Outlet.deleteMany({ warehouseId: id }, { session });
  await Shipment.deleteMany({ toType: 'Warehouse', 'to.id': id }, { session });
  await WarehouseInventory.deleteMany({ warehouseId: id }, { session });
  await Company.updateOne({}, { $inc: { totalWarehouses: -1 }, $set: { lastUpdated: new Date() } }, { session });

  return deleted;
}


// GET BY MANAGER
async function getWarehousesByManager(managerId) {
  return await Warehouse.find({ managerId });
}

// GET BY STATUS
async function getWarehousesByStatus(status) {
  return await Warehouse.find({ status });
}

async function incrementTotalOutlets(warehouseId, session) {
  await Warehouse.updateOne({ id: warehouseId }, { $inc: { totalOutlets: 1 } }, { session });
}

async function decrementTotalOutlets(warehouseId, session) {
  return Warehouse.updateOne(
    { id: warehouseId },
    { $inc: { totalOutlets: -1 } },
    { session }
  );
}


async function getWarehouseStockSummary() {
  return await Warehouse.aggregate([
    {
      $lookup: {
        from: 'warehouseinventories',
        localField: 'id',
        foreignField: 'warehouseId',
        as: 'inventory'
      }
    },
    {
      $project: {
        name: 1,
        stock: {
          $sum: '$inventory.qty'
        }
      }
    },
    { $sort: { stock: -1 } }
  ]);
}


// warehouseService.js – delete getWarehouseByManagerId, use this instead
async function getMyWarehouseData(userId) {
  const warehouse = await Warehouse.findOne({ managerId: userId })
    .select('id name location')
    .lean();

  if (!warehouse) return null;

  const user = await Account.findOne({ id: userId }).select('canCreateOutlet').lean();

  return {
    ...warehouse,
    canCreateOutlets: user?.canCreateOutlet || false
  };
}


async function getManagerOverview(managerId) {
  const warehouse = await Warehouse.findOne({ managerId }).lean();
  if (!warehouse) return null;

  const pendingShipments = await Shipment.countDocuments({
    'to.id': warehouse.id,
    toType: 'Warehouse',
    status: { $in: ['In Transit', 'Pending'] }
  });


const recentShipments = await Shipment.find({
  $or: [
    { 'to.id': warehouse.id, toType: 'Warehouse' },       // incoming
    { 'from.id': warehouse.id, fromType: 'Warehouse' }    // outgoing
  ]
})
.sort({ createdAt: -1 })
.limit(6)
.lean();

const enrichedRecent = recentShipments.map(s => ({
  date: s.date,
  from: s.from.name,
  product: s.products?.[0]?.name || 'Items',
  qty: s.products?.reduce((a, p) => a + p.qty, 0),
  status: s.status
}));

  const totalOutlets = await Outlet.countDocuments({ warehouseId: warehouse.id });

  return {
    warehouseId: warehouse.id,
    name: warehouse.name,
    location: warehouse.location,
    totalOutlets,
    totalProducts: warehouse.totalProducts,
    totalStock: warehouse.totalStock,
    totalRevenue: warehouse.totalRevenue,
    totalShipments: warehouse.totalShipments,
    pendingShipments,
    recentShipments: enrichedRecent

  };
}




module.exports = {
  createWarehouse,
  getAllWarehouses,
  getWarehouseById,
  updateWarehouse,
  removeWarehouse,
  getWarehousesByManager,
  getWarehousesByStatus,
  incrementTotalOutlets,
 decrementTotalOutlets,
 getWarehouseStockSummary,
 getMyWarehouseData,
 getManagerOverview
};
