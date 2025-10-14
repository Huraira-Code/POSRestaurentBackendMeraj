const mongoose = require('mongoose');

const voucherSchema = new mongoose.Schema({
  menuId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Menu",
    required: true
  },
 code: {
    type: Number,
    required: true,
    unique: true
  },  
  voucherPrice: {
    type: Number,
    required: true,
  }, 
  applyOnce: {
    type: Boolean,
  }
  
}, {timestamps: true});

module.exports = mongoose.model('Voucher', voucherSchema);
