const express = require("express");
const connectDB = require("./config/database");
const config = require("./config/config");
const globalErrorHandler = require("./middlewares/globalErrorHandler");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const app = express();


const PORT = config.port;
connectDB();


// Middlewares
app.use(cors({
    credentials: true,
    origin: ['http://localhost:5173' , "https://resataurentsystem.netlify.app" , "https://restaurentpos.netlify.app","https://newyorkguyspos.miteminds.com" , "http://localhost:3000" ]
}))
app.use(express.json()); // parse incoming request in json format
app.use(cookieParser())


// Root Endpoint
app.get("/", (req,res) => {
    res.json({message : "Hello from POS Server!"});
})

// Other Endpoints
app.use("/api/user", require("./routes/userRoute"));
app.use("/api/admin", require("./routes/adminRoute"));


// Global Error Handler
app.use(globalErrorHandler);


// Server
app.listen(PORT, () => {
    console.log(`☑️  POS Server is listening on port ${PORT}`);
})