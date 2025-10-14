const Receipt = require('../models/receiptModel');
const Menu = require('../models/menuModel');
const Category = require('../models/categoryModel');
const Item = require('../models/itemModel');
const uploadToCloudinary = require('../utils/cloudinary').uploadToCloudinary;
const ReceiptSettings = require('../models/receiptSettingsModel');
const Voucher = require('../models/voucherModel');

const createReceiptFormat =  async (req ,res, next) => {
  try {
    const {headerText, footerText} = req.body;
    

    const existingFormat = await ReceiptSettings.findOne({});

    if (existingFormat) {
      return res.status(400).json({ success: false, message: "Receipt format already exists" });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: "Picture is required" });
    }

     // Upload image to Cloudinary
    const cloudResult = await uploadToCloudinary(req.file.path);
    const logo = cloudResult.secure_url;
    

    const receiptSettings = await ReceiptSettings.create({
      logo,
      headerText,
      footerText
   })

    res.status(201).json({
      success: true,
      message: "Receipt format created successfully",
      receiptSettings
    }); 

  } catch (error) {
    next(error);
  }
}

const updateReceiptFormat = async (req, res, next) => {
  try {
    const { headerText, footerText, receiptFormatId } = req.body;

    // Validate receiptFormatId
    if (!receiptFormatId) {
      return res.status(400).json({ success: false, message: "Missing receiptFormatId" });
    }

    // Find the existing receipt format
    const receiptFormat = await ReceiptSettings.findById(receiptFormatId);
    if (!receiptFormat) {
      return res.status(404).json({ success: false, message: "Receipt format not found" });
    }

    // Optional file upload
    if (req.file) {
      const cloudResult = await uploadToCloudinary(req.file.path);
      receiptFormat.logo = cloudResult.secure_url;
    }

    // Optional updates
    if (headerText) receiptFormat.headerText = headerText;
    if (footerText) receiptFormat.footerText = footerText;

    const receiptSettings = await receiptFormat.save();

    res.status(200).json({
      success: true,
      message: "Receipt format updated successfully",
      receiptSettings,
    });

  } catch (error) {
    next(error);
  }
};


const printReceipt = async (req, res, next) => {
  try {
    const adminId = req.user.id;
    const {
      cart,
      paymentMethod,
      orderType,
      customerName,
      customerNumber,
      username,
      cardNumber,
      receiptNumber,
      voucherCode,
    } = req.body;

   

    const voucher = voucherCode ? await Voucher.findOne({ code: voucherCode }) : null;
    let voucherPrice = 0;
    if (voucher) {
      cart.forEach((item) => {
        if(item.menuId === voucher.menuId.toString()) {
          voucherPrice = voucher.voucherPrice;
        }
      })
    }

    const receiptSettings = await ReceiptSettings.findOne({});
    let logo = receiptSettings ? receiptSettings.logo : null;
    
    // If no receipt settings logo, try to get a menu logo as fallback
    if (!logo && cart.length > 0) {
        const firstMenuId = cart[0].menuId;
        if (firstMenuId) {
            const menu = await Menu.findById(firstMenuId).select("logo");
            if (menu && menu.logo) {
                logo = menu.logo;
            }
        }
    }

    if (!cart || cart.length === 0) {
      return res.status(400).json({ success: false, message: "Cart is empty" });
    }

    // Basic validation for card
    if (paymentMethod === 'CARD') {
      if (!username || !cardNumber || !receiptNumber) {
        return res.status(400).json({
          success: false,
          message: "Missing card details: username, cardNumber, or receiptNumber"
        });
      }
    }

    const totalAmount = cart.reduce((sum, item) => sum + item.price, 0);
    const finalAmount = Math.max(0, totalAmount - voucherPrice);

  const receiptItems = await Promise.all(cart.map(async (item) => {
  let menuName = null;

  if (item.menuId) {
    const menu = await Menu.findById(item.menuId).select("name");
    if (menu) menuName = menu.name;
  }

  const itemDoc = await Item.findById(item.itemId).select("categoryId discount tax");
  const itemDiscount = itemDoc?.discount || 0;
  const categoryId = itemDoc?.categoryId;
  let itemTax = null;
  if(paymentMethod === 'CARD') {
    itemTax = itemDoc?.tax.card
  }else {
    itemTax = itemDoc?.tax.cash
  }
  let taxNumber = parseFloat(itemTax);


  const category = await Category.findById(categoryId).select("name");
  const categoryName = category?.name;

const taxRate = taxNumber || 0;

const basePrice = item.pricePerQuantity ?? item.price;

const options = item.options || []; // array of { name, price }
const optionsTotal = options.reduce((sum, opt) => sum + (opt.price || 0), 0);

const finalUnitPrice = basePrice + optionsTotal;
const totalTax = ((finalUnitPrice * taxRate) / 100) * item.quantity;


return {
  itemId: item.itemId,
  name: item.name,
  price: finalUnitPrice,
  quantity: item.quantity,
  menuId: item.menuId || null,
  itemDiscount,
  itemTax: taxRate + "%",
  totalTax,
  options,
  categoryId: categoryId || null,
  menuName,
  categoryName
};


}));


    const itemsByMenu = receiptItems.reduce((groups, item) => {
      const menuKey = item.menuId || `name-${item.menuName || 'General Items'}`;
      const menuName = item.menuName || 'General Items';

      if (!groups[menuKey]) {
        groups[menuKey] = {
          menuId: item.menuId,
          menuName,
          items: [],
          totalAmount: 0
        };
      }

      groups[menuKey].items.push(item);
      groups[menuKey].totalAmount += (item.price * item.quantity);

      return groups;
    }, {});

    const menuGroups = Object.values(itemsByMenu);


    // Save master receipt
    

  let amountPaid = 0;

const customerReceipts = [];
const kitchenReceipts = [];

// First calculate final amount (no newReceipt used here yet)
const menuGroupSummaries = menuGroups.map((menuGroup) => {
  const isVoucherMenu = voucher && menuGroup.menuId?.toString() === voucher.menuId.toString();
  const menuVoucherDiscount = isVoucherMenu ? voucher.voucherPrice : 0;
  const totalItemDiscount = menuGroup.items.reduce((acc, item) => acc + (item.itemDiscount * item.quantity), 0);
  const totalTax = menuGroup.items.reduce((acc, item) => acc + (item.totalTax || 0), 0);

  const menuFinalAmount = Math.max(0, menuGroup.totalAmount - menuVoucherDiscount - totalItemDiscount + totalTax);

  amountPaid += menuFinalAmount;

  return {
    menuGroup,
    menuVoucherDiscount,
    totalItemDiscount,
    totalTax,
    menuFinalAmount
  };
});

// ✅ Now create newReceipt AFTER amountPaid is ready
const newReceipt = await Receipt.create({
  adminId,
  items: receiptItems,
  totalAmount: amountPaid,
  paymentMethod,
  orderType,
  customerName,
  custumerNumber: customerNumber,
  cardDetails: paymentMethod === 'CARD' ? { username, cardNumber, receiptNumber } : undefined,
  printedAt: new Date()
});

// ✅ Now build receipts using `newReceipt`
menuGroupSummaries.forEach(({ menuGroup, menuVoucherDiscount, totalItemDiscount, totalTax, menuFinalAmount }, index) => {
  const customerReceipt = {
    logo,
    _id: newReceipt._id + `_CUSTOMER_${index + 1}`,
    menuId: menuGroup.menuId,
    menuName: menuGroup.menuName,
    items: menuGroup.items,
    totalAmount: menuFinalAmount,
    itemDiscount: totalItemDiscount,
    totalTax,
    originalAmount: menuGroup.totalAmount,
    voucherPrice: menuVoucherDiscount,
    printedAt: newReceipt.printedAt,
    customerName: newReceipt.customerName,
    custumerNumber: newReceipt.custumerNumber,
    paymentMethod: newReceipt.paymentMethod,
  };

  const kitchenItems = menuGroup.items.map(({ price, ...rest }) => rest);
  const kitchenReceipt = {
    logo,
    _id: newReceipt._id + `_KITCHEN_${index + 1}`,
    menuId: menuGroup.menuId,
    menuName: menuGroup.menuName,
    items: kitchenItems,
    printedAt: newReceipt.printedAt
  };

  customerReceipts.push(customerReceipt);
  kitchenReceipts.push(kitchenReceipt);
});

    res.status(200).json({
      success: true,
      message: `${menuGroups.length} receipt(s) generated by menu`,
      customerReceipts,
      kitchenReceipts
    });

  } catch (error) {
    next(error);
  }
};


const getAllReceipts = async (req, res, next) => {
  try {
    const adminId = req.user.id;
    const receipts = await Receipt.find({adminId}).sort({ printedAt: -1 });
    res.status(200).json({
      success: true,
      receipts
    });
  } catch (error) {
    next(error);
  }
};



const getAllReceiptsForSuperAdmin = async (req, res, next) => {
  try {
    const adminId = req.params.adminId;
    const receipts = await Receipt.find({adminId}).sort({ printedAt: -1 });
    res.status(200).json({
      success: true,
      receipts
    });
  } catch (error) {
    next(error);
  }
};



module.exports = { printReceipt , getAllReceipts , getAllReceiptsForSuperAdmin, createReceiptFormat, updateReceiptFormat };