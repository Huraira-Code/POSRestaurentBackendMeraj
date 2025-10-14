const mongoose = require('mongoose');

const receiptSettingsSchema = new mongoose.Schema({
  logo: {
    type: String,
    required: true
  },
  headerText: String,
  footerText: String
});

module.exports = mongoose.model('ReceiptSettings', receiptSettingsSchema);
