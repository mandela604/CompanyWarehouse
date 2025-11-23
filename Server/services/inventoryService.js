const mongoose = require('mongoose');
const Outlet = require('../models/Outlet');
const OutletInventory = require('../models/OutletInventory');
const WarehouseInventory = require('../models/WarehouseInventory');

async function getInventory(outletId, productId) {
  return OutletInventory.findOne({ outletId, productId });
}

async function updateInventory(session, inventoryId, qtySold, revenue) {
  return OutletInventory.findOneAndUpdate(
    { id: inventoryId },
    { $inc: { qty: -qtySold, totalSold: qtySold, revenue } },
    { new: true, session }
  );
}

async function incrementOutlet(session, outletId, qtySold, revenue) {
  return Outlet.findOneAndUpdate(
    { id: outletId },
    { $inc: { totalSales: qtySold, revenue }, lastUpdated: new Date() },
    { new: true, session }
  );
}

async function incrementWarehouse(session, warehouseId, productId, revenue) {
  return WarehouseInventory.findOneAndUpdate(
    { warehouseId, productId },
    { $inc: { revenue } },
    { new: true, session }
  );
}


async function reverseInventory(session, inventoryId, qty, amount) {
  return OutletInventory.findOneAndUpdate(
    { id: inventoryId },
    { 
      $inc: { qty: qty, totalSalesValue: -amount },
      $set: { lastUpdated: new Date() }
    },
    { new: true, session }
  );
}



module.exports = {
  getInventory,
  updateInventory,
  incrementOutlet,
  incrementWarehouse,
  reverseInventory
};
