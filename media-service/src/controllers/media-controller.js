// Import logger for structured logging
const logger = require('../utils/logger.js');

// Import Cloudinary upload utility function
const { uploadMediaToCloudinary } = require('../utils/cloudinary.js');

// Import Media MongoDB model
const Media = require('../models/Media');


// ================= MEDIA UPLOAD CONTROLLER =================

const uploadMedia = async (req, res) => {

    // Log start of upload process
    logger.info('Starting file upload');

    try {

        // ================= CHECK IF FILE EXISTS =================

        // req.file is added by multer middleware
        if (!req.file) {

            logger.error("No file found. Please add a file and try again");

            return res.status(400).json({
                success: false,
                message: "No file found. Please add a file and try again",
            });
        }


        // ================= EXTRACT FILE DETAILS =================

        // Correct properties from multer file object:
        // originalname (NOT originalName)
        // mimetype (NOT mimeType)

        const { originalname, mimetype, buffer } = req.file;

        // Authenticated user ID from auth middleware
        const userId = req.user.userId;


        // Log file details
        logger.info(`File details: name=${originalname}, type=${mimetype}`);


        // ================= UPLOAD FILE TO CLOUDINARY =================

        logger.info('Uploading file to Cloudinary...');

        const cloudinaryUploadResult = await uploadMediaToCloudinary(req.file);


        // Log Cloudinary upload success
        logger.info(
            `Cloudinary upload successful. Public ID: ${cloudinaryUploadResult.public_id}`
        );


        // ================= SAVE MEDIA INFO TO DATABASE =================

        const newlyCreatedMedia = new Media({

            // Cloudinary public ID (used for deletion or management)
            publicId: cloudinaryUploadResult.public_id,

            // Original file name
            originalName: originalname,

            // File MIME type (image/png, image/jpeg, etc.)
            mimeType: mimetype,

            // Cloudinary secure URL (used for displaying image)
            url: cloudinaryUploadResult.secure_url,

            // User who uploaded file
            userId: userId
        });


        // Save media record to MongoDB
        await newlyCreatedMedia.save();


        // ================= SEND SUCCESS RESPONSE =================

        res.status(201).json({

            success: true,

            // Media ID stored in MongoDB
            mediaId: newlyCreatedMedia._id,

            // Cloudinary URL for accessing media
            url: newlyCreatedMedia.url,

            message: "Media upload successful"
        });


    } catch (error) {

        // Log error
        logger.error("Error uploading media", error);

        res.status(500).json({
            success: false,
            message: "Error uploading media",
        });
    }
};

const getAllMedias = async(req,res)=>{
    try {
        const result = await Media.find({});
        res.json({result});
    } catch (e) {
        logger.error("Error fetching media", error);

        res.status(500).json({
            success: false,
            message: "Error fetching media",
        });
    }
}

// Export controller
module.exports = { uploadMedia , getAllMedias};
