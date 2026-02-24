const Post = require('../models/Post.js');
const logger = require('../utils/logger.js');
const { publishEvent } = require('../utils/rabbitmq.js');
const {validateCreatePost} = require('../utils/validation.js')

async function invalidatePostCache(req, postId){

    // delete single post cache if provided
    if(postId){
        await req.redisClient.del(`post:${postId}`);
    }

    // delete posts list cache
    const keys = await req.redisClient.keys("posts:*");

    if(keys.length){
        await req.redisClient.del(keys);
    }
}




// ================= CREATE POST CONTROLLER =================

// This controller creates a new post in the database
// It uses authenticated userId (injected by API Gateway → Post Service middleware)

const createPost = async (req, res) => {

    // Log whenever create post endpoint is accessed
    logger.info("Create Post endpoint hit");

    try {

        // ================= VALIDATE REQUEST BODY =================

        // Validate incoming request body using Joi or custom validator
        const { error } = validateCreatePost(req.body);

        // If validation fails → return 400 Bad Request
        if (error) {

            logger.warn("Validation error", error.details[0].message);

            return res.status(400).json({
                success: false,
                message: error.details[0].message,
            });
        }


        // ================= EXTRACT DATA FROM REQUEST =================

        // Extract content and mediaIds from request body
        const { content, mediaIds } = req.body;

        // req.user.userId comes from authenticateRequest middleware
        // This userId was originally extracted from JWT in API Gateway
        const userId = req.user.userId;


        // ================= CREATE NEW POST OBJECT =================

        // Create new Post instance using Mongoose model
        const newlyCreatedPost = new Post({

            // Associate post with authenticated user
            user: userId,

            // Post text/content
            content,

            // Optional media IDs (images/videos), default to empty array
            mediaIds: mediaIds || []
        });


        // ================= SAVE POST TO DATABASE =================

        // Save post to MongoDB
        await newlyCreatedPost.save();
        
        await publishEvent("post.created",{
            postId : newlyCreatedPost._id.toString(),
            userId : newlyCreatedPost.user.toString(),
            content : newlyCreatedPost.content,
            createdAt : newlyCreatedPost.createdAt,
        });

        await invalidatePostCache(req , newlyCreatedPost._id.toString());

        // Log successful post creation
        logger.info('Post created successfully', newlyCreatedPost);


        // ================= RETURN SUCCESS RESPONSE =================

        res.status(201).json({

            success: true,

            message: 'Post created successfully'
        });

    }
    catch (e) {

        // ================= ERROR HANDLING =================

        // Log error for debugging and monitoring
        logger.error("Error creating post", e);

        // Send generic error response
        res.status(500).json({
            success: false,
            message: "Error at creating post",
        });
    }
};

// Controller to fetch all posts with pagination and Redis caching
const getAllPosts = async (req, res) => {

    // Log whenever this endpoint is hit
    logger.info("Get All Post endpoint hit");

    try {

       // ================= PAGINATION SETUP =================

       // Get page number from query params, default = 1
       const page = parseInt(req.query.page) || 1;

       // Get limit (number of posts per page), default = 10
       const limit = parseInt(req.query.limit) || 10;

       // Calculate how many posts to skip
       // Example: page=2, limit=10 → skip first 10 posts
       const startIndex = (page - 1) * limit;


       // ================= REDIS CACHE CHECK =================

       // Create unique cache key based on page and limit
       // Example: posts:1:10, posts:2:10
       const cacheKey = `posts:${page}:${limit}`;

       // Try to get cached data from Redis
       const cachedPost = await req.redisClient.get(cacheKey);

       // If cached data exists → return it immediately (CACHE HIT)
       if (cachedPost) {

           logger.info("Serving posts from Redis cache");

           // Redis stores string → convert back to JSON
           return res.json(JSON.parse(cachedPost));
       }


       // ================= FETCH FROM DATABASE (CACHE MISS) =================

       logger.info("Cache miss → fetching posts from MongoDB");

       // Fetch posts from MongoDB
       // sort → newest posts first
       // skip → skip previous page posts
       // limit → limit number of posts returned
       const posts = await Post.find({})
           .sort({ createdAt: -1 })
           .skip(startIndex)
           .limit(limit);


       // Get total number of posts in database
       // Used to calculate total pages
       const totalNoOfPost = await Post.countDocuments();


       // ================= PREPARE RESPONSE OBJECT =================

       const result = {

         // Array of posts
         posts,

         // Current page number
         currentpage: page,

         // Total pages available
         totalPages: Math.ceil(totalNoOfPost / limit),

         // Total number of posts in database
         totalPost: totalNoOfPost
       };


       // ================= SAVE DATA IN REDIS CACHE =================

       // Store result in Redis for faster future access
       // setex = set with expiry

       // cacheKey → unique key
       // 300 → expiry time in seconds (5 minutes)
       // JSON.stringify → convert object to string

       await req.redisClient.setex(
           cacheKey,
           300,
           JSON.stringify(result)
       );

       logger.info("Posts cached in Redis");


       // ================= SEND RESPONSE TO CLIENT =================

       res.json(result);

    }
    catch (e) {

        // Log error for debugging
        logger.error("Error fetching post", e);

        // Send error response
        res.status(500).json({
            success: false,
            message: "Error at fetching post",
        });
    }
};

// ================= GET SINGLE POST CONTROLLER =================

const getPost = async (req, res) => {

    // Log whenever this endpoint is hit
    logger.info("Get single Post endpoint hit");

    try {

        // ================= EXTRACT POST ID =================

        // Get postId from URL params
        // Example: /api/posts/123 → postId = 123
        const postId = req.params.id;


        // ================= CREATE REDIS CACHE KEY =================

        // Unique cache key for this post
        // Example: post:123
        const cacheKey = `post:${postId}`;


        // ================= CHECK REDIS CACHE =================

        // Try to get cached post from Redis
        const cachedPost = await req.redisClient.get(cacheKey);


        // If post exists in cache → return immediately (CACHE HIT)
        if (cachedPost) {

            logger.info("Serving post from Redis cache");

            // Convert string back to JSON and return
            return res.json(JSON.parse(cachedPost));
        }


        // ================= FETCH FROM MONGODB =================

        logger.info("Cache miss → fetching post from MongoDB");

        const singlePost = await Post.findById(postId);


        // If post does not exist in database
        if (!singlePost) {

            return res.status(404).json({
                message: "Post not found",
                success: false
            });
        }


        // ================= SAVE POST IN REDIS CACHE =================

        // Store post in Redis for faster future access

        // cacheKey → key name
        // 300 → expiry time in seconds (5 minutes)
        // JSON.stringify → convert object to string

        await req.redisClient.setex(
            cachedPost,              // Correct key name
            3600,                   // TTL (1 hrs)
            JSON.stringify(singlePost)
        );


        // ================= RETURN RESPONSE =================

        return res.json({
            singlePost,
        });

    } catch (e) {

        logger.error("Error fetching post", e);

        res.status(500).json({
            success: false,
            message: "Error at fetching post",
        });
    }
};

// ================= DELETE POST CONTROLLER =================

const deletePost = async (req, res) => {

    // Log when delete endpoint is hit
    logger.info("Delete Post endpoint hit");

    try {

        // ================= DELETE POST WITH AUTHORIZATION CHECK =================

        // findOneAndDelete does TWO things:
        // 1. Finds post by _id
        // 2. Ensures the post belongs to authenticated user
        // 3. Deletes it if both conditions match

        const post = await Post.findOneAndDelete({

            // Post ID from URL
            _id: req.params.id,

            // User ID from authentication middleware
            user: req.user.userId,
        });


        // If post not found OR user does not own post
        if (!post) {

            return res.status(404).json({
                message: "Post not found",
                success: false,
            });
        }

        //publish post delete - method
        await publishEvent('post.deleted',{
            postId : post._id.toString(),
            userId : req.user.userId,
            mediaIds : post.mediaIds
        });
        // ================= INVALIDATE REDIS CACHE =================

        // Remove cached version of this post and posts list
        // This ensures users don't see deleted post from cache

        await invalidatePostCache(req, req.params.id);


        // ================= SEND SUCCESS RESPONSE =================

        res.json({
            success: true,
            message: "Post deleted successfully"
        });


    } catch (e) {

        // Log error for debugging
        logger.error("Error Deleting post", e);

        res.status(500).json({
            success: false,
            message: "Error at Deleting post",
        });
    }
};


module.exports = {createPost , getAllPosts , getPost , deletePost};