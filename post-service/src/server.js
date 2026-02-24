// ================= LOAD ENVIRONMENT VARIABLES =================
// Loads variables from .env file into process.env
require("dotenv").config();


// ================= IMPORT REQUIRED MODULES =================

const express = require("express");                 // Express web framework
const mongoose = require("mongoose");              // MongoDB ODM (database connection)
const Redis = require("ioredis");                  // Redis client for caching and rate limiting
const cors = require("cors");                      // Enables Cross-Origin Resource Sharing
const helmet = require("helmet");                  // Adds security HTTP headers
const postRoutes = require("./routes/post-routes");// Post service routes
const errorHandler = require("./middlewares/errorHandler"); // Centralized error handler

// express-rate-limit → simple route-level rate limiter
const { rateLimit } = require("express-rate-limit");

const logger = require("./utils/logger");          // Winston logger for structured logs
const { connectToRabbitMQ } = require("./utils/rabbitmq"); // RabbitMQ connection

// RedisStore → connects express-rate-limit to Redis (distributed rate limiting)
const { RedisStore } = require("rate-limit-redis");

// RateLimiterRedis → advanced Redis-based limiter (used for global limiter)
const { RateLimiterRedis } = require("rate-limiter-flexible");


// ================= CREATE EXPRESS APP =================

const app = express();

// Use PORT from environment or default to 3002
const PORT = process.env.PORT || 3002;



// ================= DATABASE CONNECTION =================

// Connect to MongoDB using connection string from .env
mongoose
  .connect(process.env.MONGODB_URI)

  // Log success
  .then(() => logger.info("Connected to mongodb"))

  // Log error if connection fails
  .catch((e) => logger.error("Mongo connection error", e));



// ================= REDIS CONNECTION =================

// Create Redis client using REDIS_URL from .env
// Used for:
// - rate limiting
// - caching
// - distributed coordination
const redisClient = new Redis(process.env.REDIS_URL);



// ================= GLOBAL MIDDLEWARE =================

// helmet → protects against common attacks (XSS, clickjacking, etc.)
app.use(helmet());

// cors → allows frontend to access backend
app.use(cors());

// parses incoming JSON request body
app.use(express.json());


// ================= REQUEST LOGGING MIDDLEWARE =================

// Logs every request for debugging and monitoring
app.use((req, res, next) => {

  // Log request method and URL
  logger.info(`Received ${req.method} request to ${req.url}`);

  // Log request body
  logger.info(`Request body: ${JSON.stringify(req.body)}`);

  next();
});



// ================= GLOBAL RATE LIMITER (DDoS PROTECTION) =================

// This limiter protects the entire service from high traffic attacks

// Configuration:
// points = max requests allowed
// duration = time window in seconds

const globalratelimiter = new RateLimiterRedis({

  storeClient : redisClient,   // Redis stores request counts

  keyPrefix: "middleware",     // Prefix for Redis keys

  points: 50,                  // Allow 50 requests

  duration: 1                  // Per 1 second

});


// Apply global limiter middleware to ALL routes
app.use((req,res,next)=>{

  // Consume 1 point per request based on IP
  globalratelimiter.consume(req.ip)

  .then(()=> next())  // If within limit → continue request

  .catch(() =>{

    // If exceeded → block request
    logger.warn(`Rate limit exceeded for IP: ${req.ip}`);

    res.status(429).json({
       success: false,
       message: "Too many requests"
      });

  })

});



// ================= READ RATE LIMITER =================

// Protects GET endpoints (fetch posts)

// Allows high number because reading is frequent
const readLimiter = rateLimit({

  windowMs : 15*60*1000, // 15 minute window

  max : 1000,            // Allow 1000 requests per IP

  legacyHeaders:false,   // Disable old headers

  standardHeaders: true, // Enable modern rate limit headers


  // Custom handler when limit exceeded
  handler: (req, res) => {

      logger.warn(`Read rate limit exceeded for IP: ${req.ip}`);

      res.status(429).json({
        success: false,
         message: "Too many read requests"
      });
  },

  // Store rate limit counters in Redis
  // Ensures limiter works across multiple servers
  store: new RedisStore({
      sendCommand: (...args) => redisClient.call(...args),
  })

});



// ================= WRITE RATE LIMITER =================

// Protects POST and DELETE endpoints

// Write operations are expensive → stricter control
const writeLimiter = rateLimit({

  windowMs : 15*60*1000, // 15 minute window

  max : 100,            

  legacyHeaders:false,

  standardHeaders: true,

  handler: (req, res) => {

      logger.warn(`Write rate limit exceeded for IP: ${req.ip}`);

      res.status(429).json({
        success: false,
         message: "Too many write requests"
      });

  },

  store: new RedisStore({
      sendCommand: (...args) => redisClient.call(...args),
  })

});



// ================= ROUTES =================

// Inject Redis client into request object
// This allows routes to use Redis for caching
app.use('/api/posts', (req,res,next)=>{

    req.redisClient = redisClient;

    next();

}, postRoutes);



// ================= APPLY RATE LIMITERS =================

// Apply read limiter to all /api/posts routes
// GET requests will use this limiter
app.use("/api/posts", readLimiter);


// Apply write limiter ONLY to POST and DELETE
app.use("/api/posts", (req, res, next) => {

  if (["POST",  "DELETE"].includes(req.method)) {

    return writeLimiter(req, res, next);

  }

  next();

});



// ================= ERROR HANDLER =================

// Handles all errors centrally
// Must be last middleware
app.use(errorHandler);



// ================= START SERVER =================

async function startServer() {

  try {

    // Connect to RabbitMQ before starting server
    await connectToRabbitMQ();

    // Start Express server
    app.listen(PORT , ()=>{

      logger.info(`Post Service is running on port ${PORT}`);

    })

  } catch (error) {

    logger.error("Failed to connect to server", error);

    process.exit(1);

  }

}

startServer();



// ================= GLOBAL ERROR HANDLER FOR PROMISES =================

// Catches unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {

  logger.error("Unhandled Rejection at", promise, "reason:", reason);

});