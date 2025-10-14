const createHttpError = require("http-errors");
const jwt = require("jsonwebtoken");
const config = require("../config/config");
const User = require("../models/userModel");


const isVerifiedUser = (allowedRoles = []) => {
  return async (req, res, next) => {
    try {
      const { accessToken } = req.cookies;

      if (!accessToken) {
        return next(createHttpError(401, "Please provide token!"));
      }

      const decodeToken = jwt.verify(accessToken, config.accessTokenSecret);

      const user = await User.findById(decodeToken._id);
      if (!user) {
        return next(createHttpError(401, "User does not exist!"));
      }

      if (allowedRoles.length && !allowedRoles.includes(user.role)) {
        return next(createHttpError(403, "Access denied!"));
      }

      req.user = user;
      next();
    } catch (error) {
      return next(createHttpError(401, "Invalid token!"));
    }
  };
};


// const isVerifiedUser = async (req, res, next) => {
//     try{

//         const { accessToken } = req.cookies;
        
//         if(!accessToken){
//             const error = createHttpError(401, "Please provide token!");
//             return next(error);
//         }

//         const decodeToken = jwt.verify(accessToken, config.accessTokenSecret);

//         const user = await User.findById(decodeToken._id);
//         if(!user){
//             const error = createHttpError(401, "User not exist!");
//             return next(error);
//         }

//         req.user = user;
//         next();

//     }catch (error) {
//         const err = createHttpError(401, "Invalid Token!");
//         next(err);
//     }
// }

module.exports = { isVerifiedUser };