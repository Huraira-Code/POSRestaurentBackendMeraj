const mongoose = require("mongoose");

const menuSchema = new mongoose.Schema({
  logo: {
    type: String,
    required: true, // you can remove required if you want to make it optional
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
  },
  itemsID: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Item",
      required: true,
    },
  ],
}, { timestamps: true });

module.exports = mongoose.model("Menu", menuSchema);
