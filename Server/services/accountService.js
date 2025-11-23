const Account = require('../models/Account');

// Create new account
async function createAccount(data) {
  return await Account.create(data);
}

// Find by email
async function findByEmail(email) {
  return await Account.findOne({ email });
}

// Get all accounts
async function getAllAccounts() {
  return await Account.find();
}

// Get single account by ID
async function getAccountById(id) {
  return await Account.findOne({ id });
}

// Update account
async function updateAccount(id, data) {
  return await Account.findOneAndUpdate({ id }, data, { new: true });
}

// Delete account
async function deleteAccount(id) {
  return await Account.findOneAndDelete({ id });
}

// Get accounts by role
async function getAccountsByRole(role) {
  return await Account.find({ role });
}

module.exports = {
  createAccount,
  findByEmail,
  getAllAccounts,
  getAccountById,
  updateAccount,
  deleteAccount,
  getAccountsByRole
};
