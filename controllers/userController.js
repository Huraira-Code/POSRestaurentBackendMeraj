const createHttpError = require("http-errors");
const User = require("../models/userModel");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const config = require("../config/config");

const register = async (req, res, next) => {
    try {

        const { name, phone, email, password, role } = req.body;

        if(!name || !phone || !email || !password || !role){
            const error = createHttpError(400, "All fields are required!");
            return next(error);
        }

        const isUserPresent = await User.findOne({email});
        if(isUserPresent){
            const error = createHttpError(400, "User already exist!");
            return next(error);
        }


        const user = { name, phone, email, password, role };
        const newUser = User(user);
        await newUser.save();

        res.status(201).json({success: true, message: "New user created!", data: newUser});


    } catch (error) {
        next(error);
    }
}


const login = async (req, res, next) => {

    try {
        
        const { email, password } = req.body;

        if(!email || !password) {
            const error = createHttpError(400, "All fields are required!");
            return next(error);
        }

        const isUserPresent = await User.findOne({email});
        if(!isUserPresent){
            const error = createHttpError(401, "Invalid Credentials");
            return next(error);
        }

        const isMatch = await bcrypt.compare(password, isUserPresent.password);
        if(!isMatch){
            const error = createHttpError(401, "Invalid Credentials");
            return next(error);
        }

        const accessToken = jwt.sign({_id: isUserPresent._id}, config.accessTokenSecret, {
            expiresIn : '1d'
        });

        res.cookie('accessToken', accessToken, {
            maxAge: 1000 * 60 * 60 *24 * 30,
            httpOnly: true,
            sameSite: 'none',
            secure: true
        })

        res.status(200).json({success: true, message: "User login successfully!", 
            data: isUserPresent
        });


    } catch (error) {
        next(error);
    }

}

const getUserData = async (req, res, next) => {
    try {
        
        const user = await User.findById(req.user._id);
        res.status(200).json({success: true, data: user});

    } catch (error) {
        next(error);
    }
}

const logout = async (req, res, next) => {
    try {
        
        res.clearCookie('accessToken');
        res.status(200).json({success: true, message: "User logout successfully!"});

    } catch (error) {
        next(error);
    }
}


// Admin Register 
const registerAdmin = async (req, res, next) => {
    try {

        const {email, password, role } = req.body;

        if( !email || !password || !role){
            const error = createHttpError(400, "All fields are required!");
            return next(error);
        }

        const isUserPresent = await User.findOne({email});
        if(isUserPresent){
            const error = createHttpError(400, "User already exist!");
            return next(error);
        }


        const user = { email, password, role };
        const newUser = User(user);
        await newUser.save();

        res.status(201).json({success: true, message: "New user created!", data: newUser});


    } catch (error) {
        next(error);
    }
}

const updateAdmin = async (req, res, next) => {
    try {
        const { id, name, phone, email, password } = req.body;

    const admin = await User.findById(id);
    if (!admin) {
      return next(createHttpError(404, "Admin not found"));
    }

    // Update fields manually
    if (name) admin.name = name;
    if (phone) admin.phone = phone;
    if (email) admin.email = email;
    if (password) admin.password = password; // triggers pre-save hook

    await admin.save(); // pre('save') hook will hash password here

    res.status(200).json({ success: true, data: admin });

    } catch (error) {
        next(error);
    }
}

const deleteAdmin = async (req, res, next) => {
    try {
        
        const user = await User.findByIdAndDelete({_id: req.body.id});
        res.status(200).json({success: true, data: user});

    } catch (error) {
        next(error);
    }
}

const getAllAdmin = async (req, res, next) => {
    try {
        
        const admins = await User.find({ role: 'Admin' });
        res.status(200).json({success: true, data: admins});

    } catch (error) {
        next(error);
    }
}




module.exports = { register, login, getUserData, logout, registerAdmin, updateAdmin, deleteAdmin, getAllAdmin };