const express = require('express');
const {createPost , getAllPosts , getPost , deletePost} = require("../controllers/post-controller");
const {authenticateRequest} = require('../middlewares/authMiddleware.js')

const router = express.Router();

//middleware-> this will tell if user is authenticated or not
router.use(authenticateRequest);
router.post('/create-post' , createPost);
router.get('/all-posts' , getAllPosts );
router.get('/:id' , getPost );
router.delete('/:id' , deletePost );

module.exports = router;
