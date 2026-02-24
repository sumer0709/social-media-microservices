// Load environment variables from .env file
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const Redis = require("ioredis");
const cors = require("cors");
const helmet = require("helmet");

const errorHandler = require("./middlewares/errorHandler");
const logger = require("./utils/logger");

const { connectToRabbitMQ, consumeEvent } = require("./utils/rabbitmq");

const searchRoutes = require('./routes/search-route.js');

const {
  handlePostCreated,
  handlePostDeleted
} = require("./eventhandler/search-event-handler.js");

const { RateLimiterRedis } = require("rate-limiter-flexible");

const app = express();
const PORT = process.env.PORT || 3004;



// ────────────────────────────────────────────────
// MongoDB Connection (stores search index data)
// ────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() =>
    logger.info("Connected to MongoDB successfully")
  )
  .catch((e) => {
    logger.error("MongoDB connection error", e);
  });



// ────────────────────────────────────────────────
// Redis Client Initialization
// Used for rate limiting and caching
// ────────────────────────────────────────────────
const redisClient = new Redis(process.env.REDIS_URL);



// ────────────────────────────────────────────────
// Global Middleware
// ────────────────────────────────────────────────

// Adds security headers
app.use(helmet());

// Enables cross-origin requests
app.use(cors());

// Parses incoming JSON body
app.use(express.json());



// Request logging middleware
app.use((req, res, next) => {

  logger.info(
    `Received ${req.method} request to ${req.url}`
  );

  logger.info(
    `Request body: ${JSON.stringify(req.body, null, 2)}`
  );

  next();
});



// ────────────────────────────────────────────────
// Global Rate Limiting (per IP)
// Prevents abuse and DDoS
// ────────────────────────────────────────────────
const globalRateLimiter = new RateLimiterRedis({

  storeClient: redisClient,

  keyPrefix: "global_rate_limit",

  points: 100,

  duration: 1,

});



app.use(async (req, res, next) => {

  try {

    await globalRateLimiter.consume(req.ip);

    next();

  } catch {

    logger.warn(
      `Global rate limit exceeded for IP: ${req.ip}`
    );

    return res.status(429).json({
      success: false,
      message:
        "Service overloaded. Please try again later.",
    });

  }

});



// ────────────────────────────────────────────────
// Search-specific Rate Limiting (per user)
// Protects expensive search endpoint
// ────────────────────────────────────────────────
const searchLimiter = new RateLimiterRedis({

  storeClient: redisClient,

  keyPrefix: "search_rate_limit",

  points: 60,

  duration: 60,

});



app.use("/api/search", async (req, res, next) => {

  try {

    // User ID from API Gateway / Auth service
    const userId = req.headers["x-user-id"];

    // Reject if user not authenticated
    if (!userId) {

      return res.status(401).json({
        success: false,
        message:
          "Unauthorized - User ID required",
      });

    }

    // Apply rate limit per user
    await searchLimiter.consume(userId);

    next();

  } catch {

    logger.warn(
      `Search rate limit exceeded for user: ${
        req.headers["x-user-id"] || "unknown"
      }`
    );

    return res.status(429).json({
      success: false,
      message:
        "Too many search requests. Please try again later.",
    });

  }

});



// ────────────────────────────────────────────────
// Inject Redis client into request object
// Allows routes/controllers to use Redis for caching
// ────────────────────────────────────────────────
app.use(
  "/api/search",

  (req, res, next) => {

    req.redisClient = redisClient;

    next();

  },

  searchRoutes
);



// ────────────────────────────────────────────────
// Global Error Handler (must be last)
// ────────────────────────────────────────────────
app.use(errorHandler);



// ────────────────────────────────────────────────
// Start Server and Event Consumers
// Keeps search index in sync via RabbitMQ events
// ────────────────────────────────────────────────
async function startServer() {

  try {

    await connectToRabbitMQ();

    logger.info("Connected to RabbitMQ");



    await consumeEvent(
      "post.created",
      handlePostCreated
    );

    await consumeEvent(
      "post.deleted",
      handlePostDeleted
    );

    logger.info(
      "Event consumers started"
    );



    app.listen(PORT, () => {

      logger.info(
        `Search service is running on port ${PORT}`
      );

    });

  } catch (e) {

    logger.error(
      "Failed to start search service",
      e
    );

    process.exit(1);

  }

}


startServer();