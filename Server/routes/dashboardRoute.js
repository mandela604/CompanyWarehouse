const express = require('express');
const path = require('path');
const router = express.Router();

// Middleware to check login session
function ensureAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

// Serve dashboard based on role
router.get('/dashboard', ensureAuth, (req, res) => {
  const user = req.session.user;
  const filePath = path.join(__dirname, '../public');

  if (user.role === 'admin') {
    return res.sendFile(path.join(filePath, 'admin-dashboard.html'));
  }

  if (user.role === 'manager') {
    return res.sendFile(path.join(filePath, 'manager-dashboard.html'));
  }

  if (user.role === 'rep') {
    return res.sendFile(path.join(filePath, 'rep-dashboard.html'));
  }

  res.status(403).send('Role not recognized');
});

module.exports = router;
