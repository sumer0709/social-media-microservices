// ================= LOAD ENV VARIABLES =================
require('dotenv').config();

// ================= IMPORT MODULES =================
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const Redis = require('ioredis'); // Redis client
const { RateLimiterRedis } = require('rate-limiter-flexible'); // Redis rate limiter

const mediaRoutes = require('./routes/media-routes');
const errorHandler = require('./middlewares/errorHandler');
const logger = require('./utils/logger');

const { connectToRabbitMQ, consumeEvent } = require('./utils/rabbitmq.js');
const { handlePostDeleted } = require('./eventHandlers/media-event-handlers.js');


// ================= INITIALIZE EXPRESS =================
const app = express();
const PORT = process.env.PORT || 3003;


// ================= CONNECT TO MONGODB =================
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => logger.info('Connected to mongodb'))
  .catch((e) => logger.error('Mongo connection error', e));


// ================= CONNECT TO REDIS =================
const redisClient = new Redis(process.env.REDIS_URL);


// ================= GLOBAL MIDDLEWARE =================
app.use(cors());
app.use(helmet());
app.use(express.json());


// ================= REQUEST LOGGER =================
app.use((req, res, next) => {

  logger.info(`Received ${req.method} request to ${req.url}`);
  logger.info(`Request body: ${JSON.stringify(req.body)}`);

  next();

});


// ================= GLOBAL RATE LIMITER =================
// Protects service from overload or DDoS
// Limit: 100 requests per second per IP

const globalLimiter = new RateLimiterRedis({

  storeClient: redisClient,

  keyPrefix: 'media_global',

  points: 100,   // max requests

  duration: 1    // per second

});


app.use(async (req, res, next) => {

  try {

    await globalLimiter.consume(req.ip);

    next();

  } catch {

    logger.warn(`Global rate limit exceeded for IP: ${req.ip}`);

    res.status(429).json({
      success: false,
      message: 'Service overloaded. Try again later.'
    });

  }

});


// ================= UPLOAD RATE LIMITER =================
// Protects upload endpoint
// Limit: 5 uploads per minute per user

const uploadLimiter = new RateLimiterRedis({

  storeClient: redisClient,

  keyPrefix: 'media_upload',

  points: 5,    // max uploads

  duration: 60  // per minute

});


// Middleware specifically for upload route
app.use('/api/media/upload', async (req, res, next) => {

  try {

    // Get user ID from API Gateway
    const userId = req.headers['x-user-id'];

    if (!userId) {

      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });

    }

    await uploadLimiter.consume(userId);

    next();

  } catch {

    logger.warn(`Upload rate limit exceeded for user`);

    res.status(429).json({
      success: false,
      message: 'Too many uploads. Please try again later.'
    });

  }

});


// ================= ROUTES =================
app.use('/api/media', mediaRoutes);


// ================= ERROR HANDLER =================
app.use(errorHandler);


// ================= START SERVER =================
async function startServer() {

  try {

    await connectToRabbitMQ();

    await consumeEvent('post.deleted', handlePostDeleted);

    app.listen(PORT, () => {

      logger.info(`Media Service is running on port ${PORT}`);

    });

  } catch (error) {

    logger.error('Failed to connect to server', error);

    process.exit(1);

  }

}

startServer();


// ================= UNHANDLED PROMISE HANDLER =================
process.on('unhandledRejection', (reason, promise) => {

  logger.error('Unhandled Rejection at', promise, 'reason:', reason);

});