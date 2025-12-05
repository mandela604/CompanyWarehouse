const express = require('express');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const validator = require('validator');
const { ensureAuth, ensureAdmin } = require('../middlewares/auth');
const accountService = require('../services/accountService');
const Account = require('../models/Account');
const router = express.Router();



router.get('/auth/me', ensureAuth, (req,res)=>res.json(req.session.user));



// REGISTER
router.post('/register', async (req, res) => {
  try {
    let { name, email, phone, role, password } = req.body; // use let

    if (!name || !email || !password)
      return res.status(400).json({ message: 'All required fields must be filled.' });

    if (!validator.isEmail(email))
      return res.status(400).json({ message: 'Invalid email format' });

    name = validator.escape(name.trim());
    email = email.trim().toLowerCase();
    password = password.trim();

    const userCount = await Account.countDocuments();

    if (userCount > 0) {
      if (!req.session.user || req.session.user.role !== 'admin')
        return res.status(403).json({ message: 'Access denied. Admin only.' });
    }

    const assignedRole = userCount === 0 ? 'admin' : role || 'rep';

    const existing = await accountService.findByEmail(email);
    if (existing) return res.status(400).json({ message: 'Email already exists.' });

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = {
      id: uuidv4(),
      name,
      email,
      phone,
      role: assignedRole,
      password: hashedPassword
    };

    const savedUser = await accountService.createAccount(newUser);

   if (userCount === 0) {
  req.session.user = {
    id: savedUser.id,
    name: savedUser.name,
    email: savedUser.email,
    role: savedUser.role,
    phone: savedUser.phone, 
    canCreateOutlet: savedUser.canCreateOutlet 
  };
}

// Find all outlets this rep manages
const outlets = await Outlet.find({ repId: user.id }).select('id name location');
req.session.outlets = outlets.map(o => ({ id: o.id, name: o.name, location: o.location }));

// Auto-select if only one
if (outlets.length === 1) {
  req.session.currentOutletId = outlets[0].id;
}

    switch (savedUser.role) {
      case 'admin':
        return res.json({redirect: '/admin.html'});
      case 'manager':
        return res.json({redirect: '/warehouse.html'});
      case 'rep':
      if (outlets.length === 1) {
        req.session.currentOutletId = outlets[0].id;
        return res.json({ redirect: '/outlet.html' });
      } else {
        // Pass outlets list via query string
        const outletList = encodeURIComponent(JSON.stringify(outlets.map(o => ({id: o.id, name: o.name}))));
        return res.json({ redirect: `/outlet.html?select=1&outlets=${outletList}` });
      }  default:
        return res.status(403).send('Access denied'); 
    }
    
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});



// LOGIN
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await accountService.findByEmail(email);
    if (!user) return res.status(404).json({ message: 'Account not found.' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: 'Invalid credentials.' });

    // Start session
  req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone, 
      canCreateOutlet: user.canCreateOutlet
};

// Find all outlets this rep manages
const outlets = user.role === 'rep' 
  ? await Outlet.find({ repId: user.id }).select('id name location')
  : [];

req.session.outlets = user.role === 'rep' 
  ? outlets.map(o => ({ id: o.id, name: o.name, location: o.location }))
  : [];
// Auto-select if only one
if (outlets.length === 1) {
  req.session.currentOutletId = outlets[0].id;
}

    switch (user.role) {
      case 'admin':
        return res.json({ redirect: '/admin.html' });
      case 'manager':
        return res.json({redirect: '/warehouse.html'});
      case 'rep':
      if (outlets.length === 1) {
        req.session.currentOutletId = outlets[0].id;
        return res.json({ redirect: '/outlet.html' });
      } else {
        // Pass outlets list via query string 
        const outletList = encodeURIComponent(JSON.stringify(outlets.map(o => ({id: o.id, name: o.name}))));
        return res.json({ redirect: `/outlet.html?select=1&outlets=${outletList}` });
      }
      default:
        return res.status(403).send('Access denied'); 
    }

    
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});




// LOGOUT (POST)
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ redirect: '/login.html' });
  });
});



// GET ALL ACCOUNTS (admin only)
router.get('/accounts', ensureAdmin, async (req, res) => {
  try {
    // later: check admin session
    const accounts = await accountService.getAllAccounts();
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});



// GET SINGLE ACCOUNT
router.get('/accounts/:id', ensureAuth, async (req, res) => {
  try {
    const account = await accountService.getAccountById(req.params.id);
    if (!account) return res.status(404).json({ message: 'Account not found.' });
    res.json(account);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});


// UPDATE ACCOUNT
// UPDATE ACCOUNT
router.put('/accounts/:id', ensureAuth, async (req, res) => {
  try {
    const updates = { ...req.body };
    if (updates.password) {
      updates.password = await bcrypt.hash(updates.password, 10);
    }
    const updated = await accountService.updateAccount(req.params.id, updates);
    if (!updated) return res.status(404).json({ message: 'Account not found.' });

    res.json({ message: 'Account updated successfully.', account: updated });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});


// DELETE ACCOUNT
router.delete('/accounts/:id', ensureAdmin, async (req, res) => {
  try {
    const deleted = await accountService.deleteAccount(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Account not found.' });
    res.json({ message: 'Account deleted successfully.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET BY ROLE
router.get('/accounts/role/:role', ensureAdmin, async (req, res) => {
  try {
    const accounts = await accountService.getAccountsByRole(req.params.role);
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// CHANGE PASSWORD
router.patch('/accounts/:id/password', ensureAuth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!newPassword) return res.status(400).json({ message: 'New password required.' });

    const user = await accountService.getAccountById(req.params.id);
    if (!user) return res.status(404).json({ message: 'Account not found.' });

    if (oldPassword) {
      const match = await bcrypt.compare(oldPassword, user.password);
      if (!match) return res.status(401).json({ message: 'Old password incorrect.' });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await accountService.update(req.params.id, { password: hashed });

    res.json({ message: 'Password updated successfully.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
