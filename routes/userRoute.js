const express = require("express");
const { register, login, getUserData, logout, registerAdmin, updateAdmin, deleteAdmin, getAllAdmin } = require("../controllers/userController");
const { createCategory, getCategoriesForAdmin, deleteCategory, updateCategory, importCategories } = require("../controllers/categoryController");   
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { createItem, getAllItemsOfAdmin, deleteItemOfAdmin, updateItemOfAdmin, getAllItemsForAdminPanel, importItems, assignCategoriesToImportedItems } = require("../controllers/itemController");
const { createMenu, getAllMenuOfAdmin, deleteMenuOfAdmin, updateMenuOfAdmin, importMenus, assignItemToImportedMenu, removeItemFromMenu } = require("../controllers/menuController");
const upload = require('../middlewares/upload');
const { getAllReceiptsForSuperAdmin, createReceiptFormat, updateReceiptFormat } = require("../controllers/receiptController");
const { getOrdersForAdmin, exportOrdersToExcel, printDailySalesReportAndCloseDay } = require("../controllers/orderController");
const { createVoucher, updateVoucher, getAllVoucher, getVouchersByAdmin, deleteVoucher, validateVoucher } = require("../controllers/voucherController");
const { createDeal, getDealsForAdmin, updateDeal, deleteDeal, getDealById, getMyCreatedDeals, calculateDealTax } = require("../controllers/dealController");
const router = express.Router();




router.route("/register").post(register);
router.route("/login").post(login);
router.route("/logout").post(isVerifiedUser(), logout);
router.route("/superadmin-logout").post(isVerifiedUser(['SuperAdmin']), logout);
router.route("/").get(isVerifiedUser(['SuperAdmin']) , getUserData);

// Admin Management Routes
router.route("/register-admin").post(isVerifiedUser(['SuperAdmin']) , registerAdmin);
router.route("/update-admin").patch(isVerifiedUser(['SuperAdmin']) , updateAdmin);
router.route("/delete-admin").delete(isVerifiedUser(['SuperAdmin']) , deleteAdmin);
router.route("/get-admin").get(isVerifiedUser(['SuperAdmin']) , getAllAdmin);

// Category Management Routes
router.route("/create-category").post(isVerifiedUser(['SuperAdmin']), createCategory);
router.route("/admin-categories/:adminId").get(isVerifiedUser(['SuperAdmin']), getCategoriesForAdmin);
router.route("/admin-categories/:adminId").delete(isVerifiedUser(['SuperAdmin']), deleteCategory);
router.route("/admin-categories/:adminId").patch(isVerifiedUser(['SuperAdmin']), updateCategory);

// Item Management Routes
// router.route("/create-item").post(isVerifiedUser(['SuperAdmin']), createItem);
router
  .route("/create-item")
  .post(isVerifiedUser(['SuperAdmin']), upload.single('pictureURL'), createItem);
router.route("/get-items/:adminId").get(isVerifiedUser(['SuperAdmin']), getAllItemsOfAdmin);
router.route("/delete-item/:adminId").delete(isVerifiedUser(['SuperAdmin']), deleteItemOfAdmin);
router.route("/update-item/:adminId").patch(isVerifiedUser(['SuperAdmin']), upload.single('pictureURL') ,updateItemOfAdmin);


// Menu Management Routes
router
  .route('/create-menu')
  .post(isVerifiedUser(['SuperAdmin']), upload.single('logo'), createMenu);
router.route("/get-menus/:adminId").get(isVerifiedUser(['SuperAdmin']), getAllMenuOfAdmin);
router.route("/delete-menu/:adminId").delete(isVerifiedUser(['SuperAdmin']), deleteMenuOfAdmin);
router.route("/update-menu/:adminId").patch(isVerifiedUser(['SuperAdmin']),upload.single('logo') ,updateMenuOfAdmin);

// Get All Receipts of Admin
router.route("/get-receipts/:adminId").get(isVerifiedUser(['SuperAdmin']), getAllReceiptsForSuperAdmin);

// Get All Orders of Admin
router.route("/get-orders/:adminId").get(isVerifiedUser(['SuperAdmin']), getOrdersForAdmin);

// Export Orders to Excel
router.route("/export-orders/:adminId").get(isVerifiedUser(['SuperAdmin']), exportOrdersToExcel);


// Import Categories
router.route("/import-categories").post(isVerifiedUser(['SuperAdmin']), importCategories)

// Import Items
router.route("/import-items").post(isVerifiedUser(['SuperAdmin']), importItems)

// Assign Categories to Imported Items
router.route("/assign-categories").post(isVerifiedUser(['SuperAdmin']), assignCategoriesToImportedItems)

// Import Menus
router.route("/import-menus").post(isVerifiedUser(['SuperAdmin']), importMenus);

// Assign Items to Imported Menu
router.route("/assign-items").post(isVerifiedUser(['SuperAdmin']), assignItemToImportedMenu);

// Remove Item from Menu
router.route("/remove-item").post(isVerifiedUser(['SuperAdmin']), removeItemFromMenu);

// Create Receipt Settings
router.route("/receipt-settings").post(isVerifiedUser(['SuperAdmin']), upload.single('logo'), createReceiptFormat)

// Update Receipt Settings
router.route("/receipt-settings-update").patch(isVerifiedUser(['SuperAdmin']), upload.single('logo'), updateReceiptFormat)

// Voucher Management Routes
router.route("/create-voucher").post(isVerifiedUser(['SuperAdmin']), createVoucher);
router.route("/update-voucher").patch(isVerifiedUser(['SuperAdmin']), updateVoucher); 
router.route("/get-vouchers").get(isVerifiedUser(['SuperAdmin']), getAllVoucher);
router.route("/get-vouchers/:adminId").get(isVerifiedUser(['SuperAdmin']), getVouchersByAdmin);
router.route("/delete-voucher").delete(isVerifiedUser(['SuperAdmin']), deleteVoucher);
router.route("/validate-voucher").post(isVerifiedUser(['Admin', 'SuperAdmin']), validateVoucher);
router.route("/printDailySalesReportAndCloseDay").post(isVerifiedUser(['Admin']), printDailySalesReportAndCloseDay);

// Deal Management Routes (SuperAdmin)
router.route("/create-deal").post(isVerifiedUser(['SuperAdmin']), createDeal);
router.route("/get-deals/:adminId").get(isVerifiedUser(['SuperAdmin']), getDealsForAdmin);
router.route("/update-deal/:dealId").patch(isVerifiedUser(['SuperAdmin']), updateDeal);
router.route("/delete-deal/:dealId").delete(isVerifiedUser(['SuperAdmin']), deleteDeal);
router.route("/deal/:dealId").get(isVerifiedUser(['SuperAdmin']), getDealById);
router.route("/my-created-deals").get(isVerifiedUser(['SuperAdmin']), getMyCreatedDeals);
router.route("/deal-tax/:dealId").get(isVerifiedUser(['SuperAdmin', 'Admin']), calculateDealTax);

module.exports = router;