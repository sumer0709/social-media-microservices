// Load environment variables from .env file
require('dotenv').config();

// Import required modules
const mongoose = require('mongoose');              // MongoDB ODM
const logger = require('./utils/logger.js');       // Winston logger for structured logging
const express = require('express');                // Express framework
const helmet = require('helmet');                  // Security middleware (HTTP headers)
const cors = require('cors');                      // Enable Cross-Origin Resource Sharing
const { RateLimiterRedis } = require('rate-limiter-flexible'); // Advanced Redis rate limiter
const Redis = require('ioredis');                  // Redis client
const { rateLimit } = require('express-rate-limit'); // Express rate limiter
const { RedisStore } = require('rate-limit-redis');  // Redis-backed store for express-rate-limit
const routes = require('./routes/identity-service.js'); // Auth routes
const errorHandler = require("./middleware/errorHandler"); // Centralized error handler


// Create Express application
const app = express();

// Define port (fallback to 3001 if not provided)
const PORT = process.env.PORT || 3001;


// ================= DATABASE CONNECTION =================

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI) // Connection string from environment variable
  .then(() => logger.info("Connected to MongoDB")) // Log success
  .catch((e) => logger.error("Mongo connection error", e)); // Log failure


// ================= REDIS CONNECTION =================

// Initialize Redis client using REDIS_URL
const redisClient = new Redis(process.env.REDIS_URL);


// ================= GLOBAL MIDDLEWARES =================

// Adds security-related HTTP headers (prevents XSS, clickjacking, etc.)
app.use(helmet());

// Enables cross-origin requests
app.use(cors());

// Parses incoming JSON request bodies
app.use(express.json());

// Custom request logging middleware
app.use((req, res, next) => {

    // Log HTTP method and requested URL
    logger.info(`Received ${req.method} request to ${req.url}`);

    // Log request body (⚠ be careful logging sensitive data in production)
    logger.info(`Request body: ${(req.body)}`);

    next();
});


// ================= GLOBAL RATE LIMITER (DDoS Protection) =================

// Redis-based rate limiter configuration
// Allows 10 requests per second per IP
const rateLimiter = new RateLimiterRedis({
    storeClient: redisClient,  // Redis connection
    keyPrefix: 'middleware',   // Prefix for Redis keys
    points: 10,                // Max 10 requests
    duration: 1                // Per 1 second window
});

// Apply global rate limiting middleware
app.use((req, res, next) => {

    // Consume 1 point per request based on IP address
    rateLimiter.consume(req.ip)
        .then(() => next()) // If within limit → continue request
        .catch(() => {

            // If rate limit exceeded → block request
            logger.warn(`Rate limit exceeded for IP: ${req.ip}`);

            res.status(429).json({
                success: false,
                message: "Too many requests"
            });
        });
});



// ================= SENSITIVE ENDPOINT RATE LIMITER =================

// Stricter rate limiter for sensitive endpoints (e.g., registration/login)
const sensitiveEndpointsLimiter = rateLimit({

    windowMs: 15 * 60 * 1000,  // 15-minute time window
    max: 50,                   // Max 50 requests per IP in 15 minutes
    standardHeaders: true,     // Send rate limit info in headers
    legacyHeaders: false,      // Disable deprecated headers

    // Custom handler when limit exceeded
    handler: (req, res) => {

        logger.warn(`Sensitive endpoint rate limit exceeded for IP: ${req.ip}`);

        res.status(429).json({
            success: false,
            message: "Too many requests"
        });
    },

    // Use Redis store so limiter works across multiple servers
    store: new RedisStore({
        sendCommand: (...args) => redisClient.call(...args),
    })
});

const refreshTokenLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200, // allow higher limit
    standardHeaders: true,
    legacyHeaders: false,

    handler: (req, res) => {
        logger.warn(`Refresh token abuse detected for IP: ${req.ip}`);

        res.status(429).json({
            success: false,
            message: "Too many refresh attempts"
        });
    },

    store: new RedisStore({
        sendCommand: (...args) => redisClient.call(...args),
    })
});


// Apply sensitive rate limiter specifically to registration endpoint
app.use('/api/auth/register', sensitiveEndpointsLimiter);
app.use('/api/auth/login', sensitiveEndpointsLimiter);
app.use('/api/auth/refresh-token', refreshTokenLimiter);
app.use('/api/auth/logout', sensitiveEndpointsLimiter);


// ================= ROUTES =================

// Mount authentication routes under /api/auth
app.use('/api/auth', routes);


// ================= ERROR HANDLER =================

// Centralized error handling middleware (must be last middleware)
app.use(errorHandler);


// ================= START SERVER =================

app.listen(PORT, () => {

    // Log when server starts successfully
    logger.info(`Identity service running on port ${PORT}`);
});


// ================= UNHANDLED PROMISE REJECTION HANDLER =================

// Catch unhandled promise rejections globally
process.on('unhandledRejection', (reason, promise) => {

    logger.error('Unhandled Rejection at:', promise, "Reason:", reason);
});
