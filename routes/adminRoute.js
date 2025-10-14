const express = require("express");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { getCategoriesForAdmin,  } = require("../controllers/categoryController");
const { getAllMenuOfAdmin } = require("../controllers/menuController");
const { getAllItemsForAdminPanel, getAllItemsForAdmin } = require("../controllers/itemController");
const { printReceipt, getAllReceipts } = require("../controllers/receiptController");
const { createOrder, updateOrder, completeOrder, getPayment, getAllOrders, generateCustomerReceipts, updatePaymentMethod, addItemsAndDealsToOrder, deleteOrder } = require("../controllers/orderController");
const { getMyDeals } = require("../controllers/dealController");
const router = express.Router();


// Admin Routes
router.route("/get-categories").get(isVerifiedUser(["Admin"]), getCategoriesForAdmin);
router.route("/get-menus").get(isVerifiedUser(["Admin"]), getAllMenuOfAdmin);

// get all items for admin of a specific category
router.route("/get-items/:categoryId").get(isVerifiedUser(["Admin"]), getAllItemsForAdminPanel);

// get all items for admin
router.route("/get-all-items").get(isVerifiedUser(["Admin"]), getAllItemsForAdmin);

// Print Receipt
router.route("/generate-receipt").post(isVerifiedUser(["Admin"]), printReceipt);
router.route("/get-receipts").get(isVerifiedUser(["Admin"]), getAllReceipts);


// create order
router.route("/create-order").post(isVerifiedUser(["Admin"]), createOrder)
router.route("/change-payment-method").post(isVerifiedUser(["Admin"]),updatePaymentMethod )
router.route("/update-order-item-deal").post(isVerifiedUser(["Admin"]), addItemsAndDealsToOrder)

router.route("/update-order").patch(isVerifiedUser(["Admin"]), updateOrder)
router.route("/complete-order").patch(isVerifiedUser(["Admin"]), completeOrder)
router.route("/get-payment").patch(isVerifiedUser(["Admin"]), getPayment)
router.route("/orders").get(isVerifiedUser(["Admin"]), getAllOrders)
router.route("/generate-customer-receipts").post(isVerifiedUser(["Admin"]), generateCustomerReceipts)
router.route("/get-payment").patch(isVerifiedUser(["Admin"]), getPayment)
router.route("/orders").get(isVerifiedUser(["Admin"]), getAllOrders)
router.route("/deleteOrder").post(isVerifiedUser(["Admin"]), deleteOrder)

// Deal Routes (Admin)
router.route("/get-deals").get(isVerifiedUser(["Admin"]), getMyDeals);

module.exports = router;
