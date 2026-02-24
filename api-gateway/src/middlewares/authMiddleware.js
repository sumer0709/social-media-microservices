const logger = require('../utils/logger.js');
const jwt = require('jsonwebtoken');

const validateToken = (req,res,next)=>{
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(" ")[1];

    if(!token){
        logger.warn('Access attempt wihtout valid token');
        return res.status(401).json({
            message:"Authorization required",
            success:false,
        })
    }

    jwt.verify(token , process.env.JWT_SECRET_KEY , (err , user)=>{
        if(err)
        {
         logger.warn('Invalid token');
        return res.status(401).json({
            message:"Invalid token",
            success:false,
        })
        }
        req.user = user
        next();
    })
}

module.exports={validateToken};