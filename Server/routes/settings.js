const express = require('express');
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const Settings = require('../models/Settings');

const router = express.Router();

// 🔹 GET system settings
router.get('/settings', async (req, res) => {
  try {
    let settings = await Settings.findOne({ id: 'system-settings' });
    if (!settings) {
      settings = new Settings();
      await settings.save();
    }
    res.json({ settings });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch settings', error: err.message });
  }
});

// 🔹 UPDATE system settings
router.put(
  '/settings',
  [
    body('lowStockThreshold').optional().isInt({ min: 0 }).withMessage('Low stock threshold must be a non-negative integer'),
    body('managerPermissions.canCreateOutlet').optional().isBoolean(),
    body('managerPermissions.canCreateUser').optional().isBoolean(),
    body('managerPermissions.canAssignRepRole').optional().isBoolean(),
    body('config').optional().isObject()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ message: 'Invalid input', errors: errors.array() });

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const updateData = req.body;
      updateData.lastUpdated = new Date();

      const settings = await Settings.findOneAndUpdate(
        { id: 'system-settings' },
        { $set: updateData },
        { new: true, upsert: true, session }
      );

      await session.commitTransaction();
      res.json({ message: 'Settings updated', settings });
    } catch (err) {
      await session.abortTransaction();
      res.status(500).json({ message: 'Failed to update settings', error: err.message });
    } finally {
      session.endSession();
    }
  }
);

// 🔹 RESET system settings to default
router.post('/settings/reset', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const defaultSettings = new Settings(); // uses schema defaults
    const settings = await Settings.findOneAndReplace(
      { id: 'system-settings' },
      defaultSettings,
      { new: true, upsert: true, session }
    );

    await session.commitTransaction();
    res.json({ message: 'Settings reset to default', settings });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ message: 'Failed to reset settings', error: err.message });
  } finally {
    session.endSession();
  }
});

module.exports = router;
