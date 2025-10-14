// models/Counter.js
const mongoose = require('mongoose');

const CounterSchema = new mongoose.Schema({
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  counterName: {
    type: String, // e.g., "orderNumber"
    required: true,
  },
  sequence_value: {
    type: Number,
    default: 0,
  },
  last_reset_date: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true });

// Ensure each admin has its own counter type (unique pair)
CounterSchema.index({ adminId: 1, counterName: 1 }, { unique: true });

const Counter = mongoose.model('Counter', CounterSchema);
module.exports = Counter;
