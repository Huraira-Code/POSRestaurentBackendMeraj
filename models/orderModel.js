const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // 🆕 Added for daily order numbering
    orderNumber: {
      type: Number,
      required: true,
      default: 0, // This will be set by your application logic for daily orders
    },
    items: [
      {
        menuId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Menu",
          required: false,
        },
        itemId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Item",
          required: true,
        },
        name: {
          type: String,
          required: true,
        },
        price: {
          type: Number,
          required: true,
        },
        quantity: {
          type: Number,
          required: true,
        },
        itemDiscount: {
          type: Number,
          default: 0,
        },
        itemTax: {
          type: String,
          default: "0%",
        },
        totalTax: {
          type: Number,
          default: 0,
        },
        options: {
          type: Array, // or [Object] if you want strict structure
          default: [],
        },
        categoryId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Category",
        },
        menuName: {
          type: String,
        },
        categoryName: {
          type: String,
        },
        paymentMethod: {
          type: String,
          enum: ["CASH", "CARD", "ONLINE"], // adjust as needed
          default: "CASH",
        },
        paymentType: {
          type: String,
          default: null,
        },
      },
    ],
    deals: [
      {
        dealId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Deal",
          required: true,
        },
        name: {
          type: String,
          required: true,
        },
        dealPrice: {
          type: Number,
          required: true,
        },
        originalPrice: {
          type: Number,
          required: true,
        },
        customization: {
          type: Object,
          Default: [],
        },
        savings: {
          type: Number,
          required: true,
        },
        quantity: {
          type: Number,
          required: true,
          default: 1,
        },
        dealTax: {
          type: Number,
          default: 0,
        },
        items: [
          {
            itemId: {
              type: mongoose.Schema.Types.ObjectId,
              ref: "Item",
              required: true,
            },
            name: {
              type: String,
              required: true,
            },
            quantity: {
              type: Number,
              required: true,
            },
            selectedOptions: [
              {
                name: String,
                price: Number,
              },
            ],
          },
        ],
      },
    ],
    totalAmount: {
      type: Number,
      required: true,
    },
    totalTax: {
      type: Number,
      default: 0,
    },
    subtotal: {
      type: Number,
    },
    originalAmount: {
      type: Number,
    },
    finalTotal: {
      type: Number,
    },
    totalSavings: {
      type: Number,
    },
    deliveryFee: {
      type: Number,
      default: 0,
    },
    pricingDetails: {
      type: mongoose.Schema.Types.Mixed,
    },
    voucherCode: {
      type: String,
    },
    voucherDiscount: {
      type: Number,
      default: 0,
    },
    paymentStatus: {
      type: String,
      enum: ["PAID", "UNPAID"],
      default: "UNPAID",
    },
    cardDetails: {
      username: {
        type: String,
      },
      cardNumber: {
        type: String,
      },
    },
    logo: {
      type: String,
    },
    paymentMethod: {
      type: String,
      enum: ["CASH", "CARD", "ONLINE"],
    },
    paymentType: {
      type: String,
      enum: ["CASH", "CARD", "ONLINE", "COD", "cod", "online", "on_arrival"], // COD = Cash on Delivery | on_arrival = Pay on Arrival
      default: "CASH",
    },
    paymentMode: {
      type: String,
      enum: ["cash", "card", "online"],
      default: "cash",
    },
    customerInfo: {
      name: {
        type: String,
        required: false,
      },
      phone: {
        type: String,
        required: false,
      },
      address: {
        type: String,
        required: false,
      },
    },
    orderType: {
      type: String,
      enum: ["DINE", "DELIVERY", "PICKUP"],
      required: true,
    },
    orderStatus: {
      type: String,
      enum: ["IN_PROGRESS", "COMPLETED"],
      required: true,
    },
    printedAt: {
      type: Date,
      default: Date.now,
    },
    // 🆕 New field to mark orders included in a daily close report
    isEndOfDayClosed: {
      type: Boolean,
      default: false,
    },
    instruction: {
      type: String,
      required: false,
    },
    // 🆕 Kitchen Receipts (history of prints for kitchen)
    kitchenReceipts: [
      {
        items: [],
        deals: [],
      },
    ],
  },
  { timestamps: { createdAt: true, updatedAt: false } }
); // 🆕 Enable createdAt timestamp

module.exports = mongoose.model("Order", orderSchema);
