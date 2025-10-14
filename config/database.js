const mongoose = require("mongoose");
const config = require("./config");

const connectDB = async () => {
    try {
        const conn = await mongoose.connect("mongodb+srv://huraira:Usama10091@cluster0.hnawam1.mongodb.net/POSRestaurented")
        console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    } catch (error) {
        console.log(`❌ Database connection failed: ${error}`);
        process.exit();
    }
}

module.exports = connectDB;
