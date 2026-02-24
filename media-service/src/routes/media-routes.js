const express = require('express');
const multer = require('multer');

// Controller that uploads media to Cloudinary and MongoDB
const { uploadMedia, getAllMedias } = require('../controllers/media-controller.js');

// Middleware to check if user is authenticated
const { authenticateRequest } = require('../middlewares/authMiddleware.js');
const logger = require('../utils/logger.js');

const router = express.Router();

// ================= CONFIGURE MULTER =================

// multer middleware extracts file from multipart/form-data
// memoryStorage -> store file temporarily in RAM
// limits -> restrict max file size

const upload = multer({
  // Store file in memory (not disk)
  storage: multer.memoryStorage(),

  // Max file size = 5 MB
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
}).single('file');

// .single('file') means client must send field name as "file"

// ================= UPLOAD ROUTE =================

// Flow:
// authenticateRequest -> multer upload -> uploadMedia controller

router.post(
  '/upload',

  // Check user authentication first
  authenticateRequest,

  // Run multer middleware
  (req, res, next) => {
    upload(req, res, function (err) {
      // Handle multer-specific errors
      if (err instanceof multer.MulterError) {
        logger.error('Multer error while uploading:', err);

        return res.status(400).json({
          message: 'Multer error while uploading',
          error: err.message,
        });
      }

      // Handle unknown errors
      else if (err) {
        logger.error('Unknown error while uploading:', err);

        return res.status(500).json({
          message: 'Unknown error while uploading',
          error: err.message,
        });
      }

      // If no file provided
      if (!req.file) {
        return res.status(400).json({
          message: 'No file found',
        });
      }

      // Pass control to uploadMedia controller
      next();
    });
  },

  // Final controller uploads file to Cloudinary and saves MongoDB record
  uploadMedia
);

router.get('/get', authenticateRequest, getAllMedias);

module.exports = router;
