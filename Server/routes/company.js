// routes/company.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const Company = require('../models/Company');
const { ensureAdmin } = require('../middlewares/auth');
const router = express.Router();




// CREATE COMPANY (only admin)
// CREATE COMPANY (only admin)
// CREATE COMPANY (only admin)
router.post('/company', ensureAdmin, async (req, res) => {
  try {
    const { name, location, address } = req.body;

    const existing = await Company.findOne();
    if (existing) return res.status(400).json({ message: 'Company already exists' });

    const company = new Company({
      id: uuidv4(),
      name,
      location,
      address,
      adminId: req.session.user.id,
      adminName: req.session.user.name
    });

    await company.save();
    res.status(201).json({ message: 'Company created', company });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});



// EDIT COMPANY (only admin)
// EDIT COMPANY (only admin)
// EDIT COMPANY (only admin)
router.put('/company', ensureAdmin, async (req, res) => {
  try {
    const company = await Company.findOne();
    if (!company) return res.status(404).json({ message: 'Company not found' });

    const updates = req.body; // e.g., { name: 'New Name' }
    Object.assign(company, updates, { lastUpdated: new Date() });
    await company.save();

    res.json(company);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update company', error: err.message });
  }
});




// Get the single company
router.get('/company', async (req, res) => {
  try {
    const company = await Company.findOne(); // no filter since only one
    res.json(company);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch company', error: err.message });
  }
});

module.exports = router;
