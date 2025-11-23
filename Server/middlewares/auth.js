// middlewares/auth.js

// Ensure user is logged in
function ensureAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ message: 'Unauthorized. Please log in.' });
  }
  next();
}

// Ensure only admin can access
function ensureAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied. Admin only.' });
  }
  next();
}


// middlewares/outletAuth.js

function canCreateOutlet(req, res, next) {
  const user = req.session.user;
  if (!user) return res.status(401).json({ message: 'Unauthorized. Please log in.' });

  if (user.role === 'admin') return next(); // Admin can always create
  if (user.role === 'manager' && user.canCreateOutlet) return next(); // Manager allowed if toggle is on

  return res.status(403).json({ message: 'Access denied.' });
}


function ensureManager(req, res, next) {
  const user = req.session.user;
  if (!user || user.role !== 'manager') {
    return res.status(403).json({ message: 'Access denied. Only managers allowed.' });
  }
  next();
}


module.exports = { ensureAuth, ensureAdmin, canCreateOutlet, ensureManager  };
