// Import User RefreshToken model (MongoDB collection for users)
const RefreshToken = require('../models/RefreshToken.js');
const User = require('../models/User');
// Utility to generate access & refresh tokens
const generateTokens = require('../utils/generateToken.js');

// Winston logger for structured logging
const logger = require('../utils/logger.js');

// Joi (or custom) validation function for registration
const { validateRegistration , validatelogin } = require('../utils/validation.js');


// ================= USER REGISTRATION CONTROLLER =================
const registerUser = async (req, res) => {

    // Log whenever registration endpoint is accessed
    logger.info('Registration endpoint hit..');

    try {

        // ================= VALIDATE REQUEST BODY =================

        // Validate incoming data (username, email, password)
        const { error } = validateRegistration(req.body);

        // If validation fails -> return 400 (Bad Request)
        if (error) {
            logger.warn('Validation error', error.details[0].message);

            return res.status(400).json({
                success: false,
                message: error.details[0].message,
            });
        }

        // Extract required fields from request body
        const { username, email, password } = req.body;

        // ================= CHECK FOR EXISTING USER =================

        // Check if email OR username already exists in DB
        // Prevents duplicate accounts
        const userExists = await User.findOne({
            $or: [{ email }, { username }]
        });

        // If user already exists -> stop registration
        if (userExists) {
            logger.warn('User already exists', { email });

            return res.status(400).json({
                success: false,
                message: 'User already exists',
            });
        }

        // ================= CREATE NEW USER =================

        // Create new user document (password will be hashed in model hook)
        const user = new User({ username, email, password });

        // Save user in database
        await user.save();

        // Log successful user creation
        logger.info('User saved successfully', { userId: user._id.toString() });

        // ================= GENERATE TOKENS =================

        // Generate access & refresh tokens for new user
        const { accessToken, refreshToken } = await generateTokens(user);

        // ================= SEND SUCCESS RESPONSE =================

        return res.status(201).json({
            success: true,
            message: 'User registered successfully',
            accessToken,
            refreshToken
        });

    } catch (e) {

        // Log unexpected server-side errors
        logger.error('Registration error occurred', e);

        // Send generic error response (avoid exposing internal details)
        return res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// ================= LOGIN CONTROLLER =================

const loginUser = async (req, res) => {

    // Log whenever login endpoint is accessed
    logger.info('Login endpoint hit..');

    try {

        // ================= INPUT VALIDATION =================

        // Validate request body (email + password)
        const { error } = validatelogin(req.body);

        // If validation fails → return 400 Bad Request
        if (error) {
            logger.warn('Validation error', error.details[0].message);

            return res.status(400).json({
                success: false,
                message: error.details[0].message
            });
        }

        // Extract email and password from request body
        const { email, password } = req.body;


        // ================= CHECK USER EXISTS =================

        // Find user in database by email
        let user = await User.findOne({ email });

        // If user does not exist → invalid credentials
        if (!user) {
            logger.warn("Invalid user attempt");

            return res.status(400).json({
                success: false,
                message: "Invalid Credentials"
            });
        }


        // ================= PASSWORD VERIFICATION =================

        // Compare entered password with hashed password in DB
        const isValidPassword = await user.comparePassword(password);

        // If password does not match → invalid credentials
        if (!isValidPassword) {
            logger.warn("Invalid password attempt");

            return res.status(400).json({
                success: false,
                message: "Invalid Credentials"
            });
        }


        // ================= TOKEN GENERATION =================

        // Generate access & refresh tokens for authenticated user
        // ⚠ Make sure generateTokens is awaited if it's async
        const { accessToken, refreshToken } = await generateTokens(user);


        // ================= SUCCESS RESPONSE =================

        // Send tokens and userId to client
        res.json({
            success: true,
            accessToken,
            refreshToken,
            userId: user._id,
        });

    } catch (e) {

        // Log unexpected server errors
        logger.error("Login error occurred", e);

        // Send generic error response (avoid exposing internal details)
        res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
};

// ================= REFRESH TOKEN CONTROLLER =================

const refreshTokenUser = async (req, res) => {

   // Log whenever refresh endpoint is accessed
   logger.info('Refresh Token endpoint hit..');

   try {

     // Extract refresh token from request body
     const { refreshToken } = req.body;

     // ================= VALIDATE INPUT =================

     // If refresh token is missing → return 400 Bad Request
     if (!refreshToken) {
        logger.warn('Refresh Token missing');

        return res.status(400).json({
            success: false,
            message: 'Refresh token missing',
        });
     }

     // ================= VERIFY TOKEN EXISTS =================

     // Check if refresh token exists in database
     const storedToken = await RefreshToken.findOne({ token: refreshToken });

     // If token does not exist OR is expired → reject request
     if (!storedToken || storedToken.expiresAt < new Date()) {

        logger.warn("Invalid or expired refresh token");

        return res.status(401).json({
            success: false,
            message: "Invalid or expired token",
        });
     }

     // ================= FETCH USER =================

     // Get user associated with this refresh token
     const user = await User.findById(storedToken.user);

     // If user no longer exists → reject
     if (!user) {
        logger.warn("User not found");

        return res.status(401).json({
            success: false,
            message: "User not found",
        });
     }

     // ================= TOKEN ROTATION =================

     // Generate new access token and new refresh token
     // This ensures old refresh token becomes invalid
     const {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken
     } = await generateTokens(user);

     // Delete old refresh token from database
     // This prevents reuse of old token (rotation security)
     await RefreshToken.deleteOne({ _id: storedToken._id });

     // ================= SEND NEW TOKENS =================

     res.json({
        success: true,
        accessToken: newAccessToken,
        refreshToken: newRefreshToken
     });

   } catch (e) {

        // Log unexpected server errors
        logger.error("Refresh Token error occurred", e);

        // Send generic error response (avoid exposing internal details)
        res.status(500).json({
            success: false,
            message: "Internal server error",
        });
   }
};

// ================= LOGOUT CONTROLLER =================

const logoutUser = async (req, res) => {

    // Log when logout endpoint is accessed
    logger.info('Logout endpoint hit..');

    try {

        // Extract refresh token from request body
        const { refreshToken } = req.body;

        // ================= VALIDATE INPUT =================

        // If refresh token is not provided → return 400 Bad Request
        if (!refreshToken) {

            logger.warn('Refresh Token missing');

            return res.status(400).json({
                success: false,
                message: 'Refresh token missing',
            });
        }

        // ================= DELETE REFRESH TOKEN =================

        // Remove refresh token from database
        // This effectively invalidates the session
        await RefreshToken.deleteOne({ token: refreshToken });

        logger.info("Refresh token deleted during logout");

        // ================= SUCCESS RESPONSE =================

        res.json({
            success: true,
            message: "Logged out successfully",
        });

    } catch (e) {

        // Log unexpected server errors
        logger.error("Error while logging out", e);

        // Return generic server error
        res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
};

// Export controller
module.exports = { registerUser , loginUser , refreshTokenUser , logoutUser};
