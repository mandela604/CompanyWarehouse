// routes/roles.js
const express = require('express');
const { ensureAdmin } = require('../middlewares/auth');
const router = express.Router();

// GET all roles
router.get('/roles', ensureAdmin, (req, res) => {
  try {
   
    const roles = ['admin', 'manager', 'rep'];
    res.json(roles);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
