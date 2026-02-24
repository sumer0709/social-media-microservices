// Load environment variables from .env file
require('dotenv').config();


// ================= IMPORTS =================

// Express framework (used to create server)
const express = require('express');

// Enable Cross-Origin Resource Sharing (frontend can call backend)
const cors = require('cors');

// Redis client (used here for distributed rate limiting)
const Redis = require('ioredis');

// Helmet adds security headers to protect from common attacks
const helmet = require('helmet');

// Winston logger for structured logging
const logger = require('./utils/logger.js');

// express-http-proxy forwards requests to other microservices
const proxy = require('express-http-proxy');

// Centralized error handling middleware
const errorHandler = require('./middlewares/errorHandler.js');

// Rate limiting middleware
const { rateLimit } = require('express-rate-limit');

// Redis store for distributed rate limiting (shared counters)
const { RedisStore } = require('rate-limit-redis');

// JWT validation middleware (verifies token before forwarding request)
const { validateToken } = require('./middlewares/authMiddleware.js');


// ================= APP INITIALIZATION =================

// Create Express app
const app = express();

// Set port from environment variable or default to 3000
const PORT = process.env.PORT || 3000;


// ================= REDIS CONNECTION =================

// Create Redis client instance
// Redis is used to store rate limit counters
const redisClient = new Redis(process.env.REDIS_URL);


// ================= GLOBAL MIDDLEWARES =================

// Adds security headers (protects from XSS, clickjacking, etc.)
app.use(helmet());

// Enables frontend apps to communicate with this gateway
app.use(cors());

// Allows server to read JSON request bodies
app.use(express.json());


// ================= GLOBAL RATE LIMITING =================

// Create rate limiter middleware
// Limits requests per IP to prevent abuse or DDoS attacks
const globalRateLimiter = rateLimit({

    // Time window for rate limiting (15 minutes)
    windowMs: 15 * 60 * 1000,

    // Max allowed requests per IP per window
    max: 100,

    // Include rate limit info in response headers
    standardHeaders: true,

    // Disable old legacy headers
    legacyHeaders: false,

    // Custom handler when limit exceeded
    handler: (req, res) => {

        logger.warn(`Rate limit exceeded for IP: ${req.ip}`);

        return res.status(429).json({
            success: false,
            message: 'Too many requests'
        });
    },

    // Use Redis instead of memory so limits work across multiple servers
    store: new RedisStore({
        sendCommand: (...args) => redisClient.call(...args),
    })
});

// Apply rate limiter globally to all incoming requests
app.use(globalRateLimiter);



// ================= REQUEST LOGGING =================

// Logs every incoming request
app.use((req, res, next) => {

    // Log HTTP method and URL
    logger.info(`Received ${req.method} request to ${req.url}`);

    // Log request body (useful for debugging)
    logger.info(`Request body: ${JSON.stringify(req.body)}`);

    // Continue to next middleware
    next();
});



// ================= PROXY CONFIGURATION =================

// Common proxy options used by all service proxies
const proxyOptions = {

  // Rewrite incoming request path before forwarding
  // Example:
  // Client → /v1/auth/register
  // Service receives → /api/auth/register
  proxyReqPathResolver: (req) => {
    return req.originalUrl.replace(/^\/v1/, "/api");
  },

  // Handle proxy errors (service down, connection refused, etc.)
  proxyErrorHandler: (err, res, next) => {

    logger.error(`Proxy error: ${err.message}`);

    res.status(500).json({
      message: `Internal server error`,
      error: err.message,
    });
  },
};



// ================= IDENTITY SERVICE PROXY =================

// All requests to /v1/auth will be forwarded to Identity Service
app.use(
  "/v1/auth",

  proxy(process.env.IDENTITY_SERVICE_URL, {

    ...proxyOptions,

    // Modify outgoing request headers before forwarding
    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {

      // Tell identity service request body is JSON
      proxyReqOpts.headers["Content-Type"] = "application/json";

      return proxyReqOpts;
    },

    // Runs after identity service responds
    userResDecorator: (proxyRes, proxyResData, userReq, userRes) => {

      // Log response status from identity service
      logger.info(
        `Response received from Identity service: ${proxyRes.statusCode}`
      );

      // Send response back to client
      return proxyResData;
    },
  })
);



// ================= POST SERVICE PROXY =================

// All requests to /v1/posts go to Post Service

// validateToken middleware runs BEFORE proxy
// It verifies JWT and extracts userId
app.use(
  '/v1/posts',

  validateToken,

  proxy(process.env.POST_SERVICE_URL, {

    ...proxyOptions,

    // Modify outgoing request before forwarding to post service
    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {

      // Set content type to JSON
      proxyReqOpts.headers["Content-Type"] = "application/json";

      // Inject authenticated user's ID into request header
      // This allows Post Service to know which user made request
      proxyReqOpts.headers["x-user-id"] = srcReq.user.userId;

      return proxyReqOpts;
    },

    // Runs after post service responds
    userResDecorator: (proxyRes, proxyResData, userReq, userRes) => {

      logger.info(
        `Response received from Post service: ${proxyRes.statusCode}`
      );

      return proxyResData;
    }

  })
);



app.use('/v1/media' , validateToken , proxy(process.env.MEDIA_SERVICE_URL , {
  ...proxyOptions,
  proxyReqOptDecorator:(proxyReqOpts , srcReq)=>{
    proxyReqOpts.headers['x-user-id'] = srcReq.user.userId;
    if(!srcReq.headers['content-type'].startsWith('multipart/form-data')){
      proxyReqOpts.headers['Content-Type']="application/json";
    }
    return proxyReqOpts;
  },
   userResDecorator: (proxyRes, proxyResData, userReq, userRes) => {

      logger.info(
        `Response received from Media service: ${proxyRes.statusCode}`
      );

      return proxyResData;
    },
    parseReqBody: false
}))

app.use(
  '/v1/search',

  validateToken,

  proxy(process.env.SEARCH_SERVICE_URL, {

    ...proxyOptions,

    // Modify outgoing request before forwarding to post service
    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {

      // Set content type to JSON
      proxyReqOpts.headers["Content-Type"] = "application/json";

      // Inject authenticated user's ID into request header
      // This allows Post Service to know which user made request
      proxyReqOpts.headers["x-user-id"] = srcReq.user.userId;

      return proxyReqOpts;
    },

    // Runs after post service responds
    userResDecorator: (proxyRes, proxyResData, userReq, userRes) => {

      logger.info(
        `Response received from Search service: ${proxyRes.statusCode}`
      );

      return proxyResData;
    }

  })
);

// ================= CENTRALIZED ERROR HANDLER =================

// Handles all unhandled errors
// Must be the last middleware
app.use(errorHandler);



// ================= START SERVER =================

// Start API Gateway server
app.listen(PORT, () => {

    logger.info(`API Gateway is running on port ${PORT}`);

    logger.info(`Identity service URL: ${process.env.IDENTITY_SERVICE_URL}`);

    logger.info(`Post service URL: ${process.env.POST_SERVICE_URL}`);

    logger.info(`Media service URL: ${process.env.MEDIA_SERVICE_URL}`);

    logger.info(`Search service URL: ${process.env.SEARCH_SERVICE_URL}`);

    logger.info(`Redis URL: ${process.env.REDIS_URL}`);
});
