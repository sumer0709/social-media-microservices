// Import custom Winston logger
// This ensures all errors go through structured logging
const logger = require('../utils/logger.js');


// Express error-handling middleware
// IMPORTANT: 4 parameters (err, req, res, next)
// Express recognizes it as error middleware because of this signature
const errorHandler = (err, req, res, next) => {

    // Log full error stack using Winston
    // stack gives detailed debugging info (file name, line number, etc.)
    logger.error(err?.stack || err);

    if (res.headersSent) {
        return next(err);
    }

    // Send safe response to client
    // If error has custom status -> use it
    // Otherwise default to 500 (Internal Server Error)
    return res.status(err.status || 500).json({

        // Send actual error message if exists
        // Otherwise send generic message
        message: process.env.NODE_ENV === 'production'
            ? 'Internal Server Error'
            : err.message

    });
};


// Export middleware so it can be used in app.js
module.exports = errorHandler;
