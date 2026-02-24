const Media = require('../models/Media.js');
const { deleteMediaFromCloudinary } = require('../utils/cloudinary');
const logger = require('../utils/logger.js');

const handlePostDeleted = async (event) => {
    const { postId, mediaIds } = event;
    try {
        const mediaToDelete = await Media.find({ _id: { $in: mediaIds } });
        for (const media of mediaToDelete) {
            await deleteMediaFromCloudinary(media.publicId);
            await Media.findByIdAndDelete(media._id);

            logger.info(`Deleted media ${media._id} associated with this deleted post ${postId}`);
        }
        logger.info('Processed deletion of media for post id', postId);
    } catch (e) {
        logger.error('Error occured while media deletion', e);
    }
};

module.exports = { handlePostDeleted };
