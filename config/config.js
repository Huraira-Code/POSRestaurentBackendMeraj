require("dotenv").config();

const config = Object.freeze({
    port: process.env.PORT || 3000,
    databaseURI: process.env.MONGODB_URI,
    nodeEnv : process.env.NODE_ENV || "development",
    accessTokenSecret: "huraira12039",
});

module.exports = config;
