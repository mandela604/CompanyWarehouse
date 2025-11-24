require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const helmet = require('helmet');

// Routes
const accountRoutes = require('./Server/routes/accounts');
const companyRoutes = require('./Server/routes/company');
const dashboardRoute = require('./Server/routes/dashboardRoute');
const outletRoutes = require('./Server/routes/outlets');
const productRoutes = require('./Server/routes/products');
const rolesRoutes = require('./Server/routes/roles');
const salesRoutes = require('./Server/routes/sales');
const settingsRoutes = require('./Server/routes/settings');
const shipmentRoutes = require('./Server/routes/shipments');
const warehouseRoutes = require('./Server/routes/warehouses');

const app = express();

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://kit.fontawesome.com"]
    }
  }
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Session setup
app.set('trust proxy', 1);
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 1 day
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true
  }
}));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/login.html')));

// Routes
app.use('/api', accountRoutes);
app.use('/api', companyRoutes);
app.use('/', dashboardRoute);
app.use('/api', outletRoutes);
app.use('/api', productRoutes);
app.use('/api', rolesRoutes);
app.use('/api', salesRoutes);
app.use('/api', settingsRoutes);
app.use('/api', shipmentRoutes);
app.use('/api', warehouseRoutes);

// 404 fallback
app.use((req, res) => res.status(404).send('Page not found'));

// General error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: 'Something went wrong', error: err.message });
});

module.exports = app;