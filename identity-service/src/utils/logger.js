// Import Winston (logging library)
const winston = require('winston');

// Import dotenv to load environment variables from .env file
const dotenv = require('dotenv');

// Load .env variables into process.env
dotenv.config();

// Create a custom logger instance
const logger = winston.createLogger({

    // Set logging level based on environment
    // production → show only important logs (info, warn, error)
    // development → show detailed logs (debug and above)
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',

    // Define how logs should be formatted
    format: winston.format.combine(

        // Add timestamp to every log
        winston.format.timestamp(),

        // If an error object is logged, include full stack trace
        winston.format.errors({ stack: true }),

        // Allow printf-style string formatting
        // Example: logger.info("User %s logged in", username)
        winston.format.splat(),

        // Output logs in JSON format (useful for production & log tools)
        winston.format.json()
    ),

    // Default metadata added to every log automatically
    // Useful in microservices to identify which service generated the log
    defaultMeta: { service: "identity-service" },

    // Define where logs should be sent (transports)
    transports: [

        // Console transport (prints logs in terminal)
        new winston.transports.Console({

            // Override format ONLY for console
            // Makes logs readable & colorful in development
            format: winston.format.combine(
                winston.format.colorize(),  // Color levels (error=red, warn=yellow, etc.)
                winston.format.simple()     // Simple readable text format
            ),
        }),

        // File transport for errors only
        // Only logs with level 'error' will be saved here
        new winston.transports.File({
            filename: 'error.log',
            level: 'error'
        }),

        // File transport for all logs (based on main level setting)
        // Stores complete application activity
        new winston.transports.File({
            filename: 'combined.log'
        })
    ]
});

// Export logger to use in other files
module.exports = logger;
