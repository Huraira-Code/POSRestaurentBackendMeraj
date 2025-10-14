const mongoose = require("mongoose");

const optionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    option: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const itemSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    pictureURL: {
      type: String,
      required: true,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },

    tax: {
      card: {
        type: String,
        required: true,
      },
      cash: {
        type: String,
        required: true,
      },
    },

    discount: {
      type: Number,
    },

    options: [optionSchema],

    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Item", itemSchema);
