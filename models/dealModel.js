// In your Deal model file (e.g., dealModel.js)

const mongoose = require("mongoose");

// Deal Item Schema
const dealItemSchema = new mongoose.Schema(
  {
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Item",
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    selectedOptions: [
      {
        name: String,
        price: Number,
      },
    ],
  },
  { _id: false }
);

// Nested Option Schema
const optionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    price: {
      type: Number,
      default: 0,
    },
    // 👇 recursive nesting: options within options
    subOptions: [
      {
        name: {
          type: String,
          required: true,
          trim: true,
        },
        price: {
          type: Number,
          default: 0,
        },
        subOptions: [
          {
            name: { type: String},
            price: { type: Number, default: 0 },
          },
        ],
      },
    ],
  },
  { _id: true }
);

// Customization schema (with recursive options)
const customizationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    minSelect: {
      type: Number,
      default: 0,
    },
    maxSelect: {
      type: Number,
      required: true,
    },
    options: [optionSchema],
  },
  { _id: true }
);


// Deal Schema
const dealSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    items: [dealItemSchema],
    customizations: [customizationSchema],
    dealPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    // 👇 RECOMMENDATION: Convert originalPrice to a Mongoose Virtual
    // If originalPrice is a stored field, ensure it's calculated and saved correctly before tax calculation.
    originalPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    savings: {
      type: Number,
      default: 0,
      min: 0,
    },
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    validFrom: {
      type: Date,
      default: Date.now,
    },
    validUntil: {
      type: Date,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

// Validation middleware for customizations
dealSchema.pre("save", function (next) {
  if (this.customizations && this.customizations.length > 0) {
    for (const customization of this.customizations) {
      if (customization.minSelect > customization.maxSelect) {
        return next(
          new Error(
            `${customization.name}: minSelect cannot be greater than maxSelect`
          )
        );
      }
      if (!customization.options || customization.options.length === 0) {
        return next(
          new Error(`${customization.name}: must have at least one option`)
        );
      }
    }
  }
  next();
});

// Method to populate items for response
dealSchema.methods.getDetailsWithItems = async function () {
  return this.populate({
    path: "items.itemId",
    select: "name price tax", // Ensure 'tax' is selected for calculation
  });
};

// Modified calculateTax method to handle originalPrice = 0
dealSchema.methods.calculateTax = async function (paymentMethod = "CASH") {
  const Item = mongoose.model("Item"); // Get the Item model
  let totalTax = 0;

  // IMPORTANT: Ensure this.items is populated and this.originalPrice is correctly set
  // before calling this method. If originalPrice is a virtual, it must be accessed
  // AFTER population has occurred.

  if (!this.items || this.items.length === 0) {
    console.warn("Deal has no items, returning 0 tax.");
    return 0;
  }

  // If originalPrice is 0, it means either it's not set, or all items are free.
  // In a real scenario, this should be avoided as it leads to division by zero for proportion.
  // We'll return 0 tax in this case to prevent NaN.
  if (this.originalPrice === 0 || isNaN(this.originalPrice)) {
    console.warn(
      `Deal ID: ${this._id} - originalPrice is 0 or NaN (${this.originalPrice}). Returning 0 tax.`
    );
    return 0; // Prevent division by zero and NaN results
  }

  for (const dealItem of this.items) {
    // Ensure item.itemId is populated, otherwise item will be null or just an ID
    const item = dealItem.itemId; // Access directly if already populated
    
    // If item.itemId was not populated, you'd need to fetch it here:
    // const item = await Item.findById(dealItem.itemId);

    if (item && item.tax) {
      const taxRate =
        paymentMethod === "CARD"
          ? parseFloat(item.tax.card || "0") // Use "0" as fallback string, then parseFloat
          : parseFloat(item.tax.cash || "0");

      // Ensure taxRate is a valid number
      if (isNaN(taxRate)) {
          console.warn(`Item ID: ${item._id} has invalid tax rate (${item.tax.card}/${item.tax.cash}). Assuming 0 tax for this item.`);
          continue; // Skip this item's tax calculation
      }

      // Calculate tax on the proportional price of each item in the deal
      const itemProportion = (item.price * dealItem.quantity) / this.originalPrice;
      const itemDealPrice = this.dealPrice * itemProportion;
      const itemTax = (itemDealPrice * taxRate) / 100;

      // Add to total only if itemTax is a valid number
      if (!isNaN(itemTax)) {
          totalTax += itemTax;
      } else {
          console.warn(`Calculated item tax for Item ID: ${item._id} is NaN. Skipping.`);
      }
    } else {
        console.warn(`Item ID: ${dealItem.itemId} not found or missing tax info when calculating deal tax.`);
    }
  }

  return totalTax;
};

dealSchema.index(
  { adminId: 1, name: 1 },
  {
    unique: true,
    collation: { locale: "en", strength: 2 },
  }
);

module.exports = mongoose.model("Deal", dealSchema);
