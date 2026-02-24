const Search = require("../models/Search");
const logger = require("../utils/logger.js");

const searchPostController = async(req, res) => {
  logger.info("Search endpoint hit ..");
  try {
    // Extract the search query string from the URL (e.g., /search?query=hello)
    const redis= req.redisClient;
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({
        success: false,
        message: "Search query is required"
      });
    }

    const cacheKey = `search:${query.toLowerCase()}`;

    const cacheResult = await redis.get(cacheKey);

    if(cacheResult)
    {
      logger.info("Serving search from Redis cache");
        return res.json(JSON.parse(cacheResult));
    }


    const result = await Search.find(
      // $text: $search performs a full-text search on fields that have a text index
      // e.g., if you indexed "title" and "body", it searches across both
      {
        $text: { $search: query }
      },
      {
        // Ask MongoDB to compute a relevance score for each matched document
        // Higher score = better match for the search query
        score: { $meta: 'textScore' }
      }
    )
    // Sort results from most relevant to least relevant
    .sort({ score: { $meta: 'textScore' } })
    // Only return the top 10 results
    .limit(10);
    
    await redis.setex(
      cacheKey,
      60,
      JSON.stringify(result)
    );
    // Send the matched documents back to the client as JSON
    res.json(result);

  } catch (e) {
    // Log the error for debugging and return a 500 response
    logger.error("Error while searching post", e);
    res.status(500).json({
      success: false,
      message: "Error while searching post",
    });
  }
}

module.exports = {searchPostController};