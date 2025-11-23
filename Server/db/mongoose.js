if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const mongoose = require('mongoose');
const uri = process.env.MONGO_URI;
console.log('Company DB URI value:', uri); // Debug

if (!uri) {
  throw new Error('MONGO_URI is undefined in environment variables');
}

const isProduction = process.env.NODE_ENV === 'production';
mongoose.set('strictQuery', true);

const options = {
  maxPoolSize: 20,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  maxIdleTimeMS: 10000,
  autoIndex: !isProduction,
};

let connectionAttempts = 0;
const maxRetries = 5;

async function connectWithRetry() {
  try {
    connectionAttempts += 1;
    console.log('Attempting to connect Company DB with URI:', uri); // Debug
    await mongoose.connect(uri, options);
    console.info('✅ Company MongoDB connected');
  } catch (err) {
    console.error('Full Company MongoDB error:', err);
    console.error(`Company MongoDB connection attempt ${connectionAttempts} failed:`, err);
    if (connectionAttempts < maxRetries) {
      const backoff = Math.min(1000 * 2 ** connectionAttempts, 30000);
      console.info(`Retrying Company DB connection in ${backoff / 1000}s...`);
      setTimeout(connectWithRetry, backoff);
    } else {
      console.error('Exceeded max Company MongoDB connection retries. Exiting.');
      process.exit(1);
    }
  }
}

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ Company MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
  console.info('🔁 Company MongoDB reconnected');
});

mongoose.connection.on('error', (err) => {
  console.error('Company MongoDB error:', err);
});

function handleShutdown(signal) {
  console.info(`Received ${signal}, stopping server and closing Company MongoDB connection...`);
  if (global.server && typeof global.server.close === 'function') {
    global.server.close(() => {
      console.info('🛑 Server stopped accepting new connections.');
      closeMongoAndExit();
    });
  } else {
    closeMongoAndExit();
  }
  setTimeout(() => {
    console.warn('⏱️ Forced shutdown after timeout.');
    process.exit(1);
  }, 15000);
}

async function closeMongoAndExit() {
  try {
    await mongoose.disconnect();
    console.info('✅ Company MongoDB connection closed. Exiting.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error closing Company MongoDB connection:', err);
    process.exit(1);
  }
}

['SIGINT', 'SIGTERM', 'SIGQUIT'].forEach(sig => {
  process.on(sig, () => handleShutdown(sig));
});

module.exports = {
  connect: connectWithRetry,
  connection: mongoose.connection,
  mongoose,
};
