const Company = require('../models/Company');

async function incrementRevenue(session, amount, unitsSold = 0) {
  return Company.findOneAndUpdate(
    {}, 
    { 
      $inc: { totalRevenue: amount, totalUnitsSold: unitsSold },
      $set: { lastUpdated: new Date() }
    },
    { new: true, session }
  );
}


async function decrementRevenue(session, amount, unitsSold = 0) {
  return Company.findOneAndUpdate(
    {},
    { 
      $inc: { totalRevenue: -amount, totalUnitsSold: -unitsSold },
      $set: { lastUpdated: new Date() }
    },
    { new: true, session }
  );
}



// Increment total outlets
async function incrementTotalOutlets(session = null) {
  const options = { new: true };
  if (session) options.session = session;

  return Company.findOneAndUpdate(
    {},
    { 
      $inc: { totalOutlets: 1 }, 
      $set: { lastUpdated: new Date() } 
    },
    options
  );
}


// Decrement total outlets

async function decrementTotalOutlets(session) {
  return Company.findOneAndUpdate(
    {},
    { $inc: { totalOutlets: -1 }, $set: { lastUpdated: new Date() } },
    { new: true, session }
  );
}

// Increment total warehouses
async function incrementTotalWarehouses() {
  return Company.findOneAndUpdate(
    {},
    { $inc: { totalWarehouses: 1 }, $set: { lastUpdated: new Date() } },
    { new: true }
  );
}

// Decrement total warehouses
async function decrementTotalWarehouses() {
  return Company.findOneAndUpdate(
    {},
    { $inc: { totalWarehouses: -1 }, $set: { lastUpdated: new Date() } },
    { new: true }
  );
}


module.exports = {
    incrementRevenue,
  incrementTotalOutlets,
  decrementTotalOutlets,
  incrementTotalWarehouses,
  decrementTotalWarehouses,
  decrementRevenue
};
