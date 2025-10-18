const Voucher = require("../models/voucherModel");
const Receipt = require("../models/receiptModel");
// const uploadToCloudinary = require('../utils/cloudinary').uploadToCloudinary;
const Order = require("../models/orderModel");
const Menu = require("../models/menuModel");
const Category = require("../models/categoryModel");
const Item = require("../models/itemModel");
const Deal = require("../models/dealModel");
const ReceiptSettings = require("../models/receiptSettingsModel");
const Counter = require("../models/counterModel"); // Adjust the path as needed

async function mapOrderItem(orderItem, paymentMethod) {
  const fullItem = await Item.findById(orderItem.itemId)
    .populate("categoryId", "name") // populate category
    .select(
      "name price discount tax categoryId adminId pictureURL options createdAt updatedAt __v"
    );

  if (!fullItem) throw new Error(`Item with ID ${orderItem.itemId} not found`);
  console.log("full item", fullItem);
  // find menu info
  let menuInfo = null;
  if (orderItem.menuId) {
    menuInfo = await Menu.findById(orderItem.menuId).select("name logo");
  }

  const categoryName = fullItem.categoryId?.name || "General";

  // options handling
  const options = orderItem.options || [];
  console.log("myfault2", orderItem);
  console.log("myfault1", options);
  const optionsTotal = options.reduce((sum, opt) => sum + (opt.price || 0), 0);

  const basePrice = fullItem.price;
  const unitPrice = basePrice + optionsTotal;

  // tax handling
  const itemTaxRate =
    paymentMethod === "CARD"
      ? parseFloat(fullItem.tax?.card || 0)
      : parseFloat(fullItem.tax?.cash || 0);

  const totalItemRevenue = unitPrice * orderItem.quantity;
  const totalItemTax = totalItemRevenue * (itemTaxRate / 100);
  const totalItemDiscount = ((fullItem.discount || 0) / 100) * totalItemRevenue;

  return {
    // Core IDs
    _id: fullItem._id,
    itemId: fullItem._id,

    // Naming
    name: fullItem.name,
    originalName: fullItem.name,

    // Admin / Category
    adminId: fullItem.adminId,
    categoryId: fullItem.categoryId?._id || fullItem.categoryId,
    categoryName,

    // Menu
    menuId: orderItem.menuId || null,
    menuName: orderItem.menuName || menuInfo?.name || "General Items",
    menuLogo: menuInfo?.logo || null,

    // Timestamps
    createdAt: fullItem.createdAt,
    updatedAt: fullItem.updatedAt,
    __v: fullItem.__v,

    // Pricing
    originalPrice: fullItem.price,
    basePrice: fullItem.price,
    price: unitPrice,
    totalPrice: totalItemRevenue,

    // Discounts
    discount: fullItem.discount || 0,
    itemDiscount: totalItemDiscount,

    // Taxes
    tax: fullItem.tax || { cash: "0", card: "0" },
    itemTax: itemTaxRate,
    cashTax: fullItem.tax?.cash || "0",
    cardTax: fullItem.tax?.card || "0",
    totalTax: totalItemTax,

    // Options
    options: options || [],
    selectedOptions: options,

    // Media
    pictureURL: fullItem.pictureURL || "",

    // Order-specific
    quantity: orderItem.quantity,
    paymentMethod: orderItem.paymentMethod,
    paymentType: orderItem.paymentType,

    // Calculated fields
    itemSubtotal: totalItemRevenue,
    itemTotalAfterDiscount: totalItemRevenue - totalItemDiscount,
    finalItemPrice: unitPrice - (fullItem.discount || 0),

    // Status
    status: "active",
    isNewlyAdded: false,
  };
}

const createOrder = async (req, res, next) => {
  try {
    const adminId = req.user.id;
    const {
      cart,
      deals,
      orderType,
      paymentMethod,
      paymentType,
      paymentMode,
      customerInfo,

      instruction, // 🆕 take from body
      deliveryFee,
    } = req.body;

    const receiptSettings = await ReceiptSettings.findOne({});
    let logo = receiptSettings ? receiptSettings.logo : null;

    if (!logo && cart.length > 0) {
      const firstMenuId = cart[0].menuId;
      if (firstMenuId) {
        const menu = await Menu.findById(firstMenuId).select("name logo");
        if (menu && menu.logo) {
          logo = menu.logo;
          if (!receiptSettings) {
            try {
              await ReceiptSettings.create({
                logo: menu.logo,
                headerText: "Welcome to our restaurant",
                footerText: "Thank Guests for your visit!",
              });
              console.log("Auto-created receipt settings with menu logo");
            } catch (error) {
              console.log(
                "Failed to auto-create receipt settings:",
                error.message
              );
            }
          }
        }
      }
    }

    if ((!cart || cart.length === 0) && (!deals || deals.length === 0)) {
      return res
        .status(400)
        .json({ success: false, message: "Cart and deals are both empty" });
    }

    // --- Start: Atomic Counter Logic ---
    const today = new Date();
    today.setHours(0, 0, 0, 0); // normalize to midnight

    const nextOrderNumber = await Counter.findOneAndUpdate(
      {
        adminId: adminId, // ✅ each admin has its own counter
        counterName: "orderNumber", // ✅ fixed counter name
      },
      [
        {
          $set: {
            sequence_value: {
              $cond: [
                { $lt: ["$last_reset_date", today] }, // agar purana hai toh reset
                1, // reset to 1
                { $add: ["$sequence_value", 1] }, // warna increment
              ],
            },
            last_reset_date: today,
          },
        },
      ],
      {
        new: true,
        upsert: true,
      }
    ).then((doc) => doc.sequence_value);

    // --- End: Atomic Counter Logic ---

    // Process cart items
    let totalAmount = 0;
    let totalTax = 0;
    let totalSavings = 0;
    let totalVoucherDiscount = 0;
    let orderItems = [];

    if (cart && cart.length > 0) {
      orderItems = await Promise.all(
        cart.map((item) => mapOrderItem(item, paymentMethod))
      );
      console.log("order item", orderItems);
      // aggregate totals
      orderItems.forEach((it) => {
        totalAmount += it.itemSubtotal;
        totalTax += it.totalTax;
        totalSavings += it.itemDiscount;
      });
    }

    // Process deals
    let orderDeals = [];
    if (deals && deals.length > 0) {
      orderDeals = await Promise.all(
        deals.map(async (dealItem) => {
          const deal = await Deal.findById(dealItem.dealId).populate({
            path: "items.itemId",
            select: "name price tax",
          });

          if (!deal)
            throw new Error(`Deal with ID ${dealItem.dealId} not found`);
          if (!deal.isActive)
            throw new Error(`Deal ${deal.name} is not active`);
          if (deal.validUntil && new Date() > deal.validUntil)
            throw new Error(`Deal ${deal.name} has expired`);
          if (deal.adminId.toString() !== adminId)
            throw new Error(`Deal ${deal.name} does not belong to this admin`);

          const dealQuantity = dealItem.quantity || 1;
          const dealTaxRate = await deal.calculateTax(paymentMethod);
          const totalDealPrice = dealItem.totalPrice * dealQuantity;
          const totalDealTax = totalDealPrice * (dealTaxRate / 100);

          totalAmount += totalDealPrice;
          totalTax += totalDealTax;
          totalSavings += deal.savings * dealQuantity;
          console.log("meraaaaaaaaaa2", dealItem);
          return {
            dealId: deal._id,
            name: deal.name,
            dealPrice: dealItem.totalPrice,
            customization: dealItem.selectedCustomizations,
            originalPrice: deal.originalPrice * dealQuantity,
            savings: deal.savings * dealQuantity,
            quantity: dealQuantity,
            dealTax: totalDealTax,
            items: deal.items.map((item) => ({
              itemId: item.itemId._id,
              name: item.itemId.name,
              quantity: item.quantity,
              selectedOptions: item.selectedOptions || [],
            })),
          };
        })
      );
    }
    console.log("order item 2", orderItems);
    const newOrder = await Order.create({
      adminId,
      orderNumber: nextOrderNumber,
      items: orderItems,
      deals: orderDeals,
      totalAmount: totalAmount + totalTax + deliveryFee,
      totalTax,
      totalSavings,
      deliveryFee,
      orderType,
      paymentMethod,
      paymentType,
      paymentMode,
      customerInfo,
      instruction, // 🆕 save to DB
      orderStatus: "IN_PROGRESS",
      printedAt: new Date(),
    });

    // Convert to plain object so we can safely mutate
    const responseOrder = newOrder.toObject();

    // Replace items in the response with your enriched version
    responseOrder.items = orderItems;

    return res.status(200).json({
      success: true,
      message: "Order created successfully",
      data: responseOrder,
    });
  } catch (error) {
    next(error);
  }
};

const addItemsAndDealsToOrder = async (req, res, next) => {
  try {
    const { orderId, cart, deals } = req.body;
    const adminId = req.user.id;

    if (!orderId) {
      return res
        .status(400)
        .json({ success: false, message: "Order ID is required" });
    }

    // Find existing order
    const existingOrder = await Order.findById(orderId);
    if (!existingOrder) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }
    console.log("wafa na bewafi", existingOrder.paymentMethod);
    // Init totals
    let totalAmount = 0;
    let totalTax = 0;
    let totalSavings = 0;
    let totalVoucherDiscount = 0;

    // =====================
    // Process new items
    // =====================
    let orderItems = [];
    if (cart && cart.length > 0) {
      orderItems = await Promise.all(
        cart.map((item) => mapOrderItem(item, existingOrder.paymentMethod)) // <-- same helper you use in create
      );

      orderItems.forEach((it) => {
        totalAmount += it.itemSubtotal;
        totalTax += it.totalTax;
        totalSavings += it.itemDiscount;
      });
    }

    // =====================
    // Process new deals
    // =====================
    let orderDeals = [];
    if (deals && deals.length > 0) {
      orderDeals = await Promise.all(
        deals.map(async (dealItem) => {
          const deal = await Deal.findById(dealItem.dealId).populate({
            path: "items.itemId",
            select: "name price tax",
          });

          if (!deal)
            throw new Error(`Deal with ID ${dealItem.dealId} not found`);
          if (!deal.isActive)
            throw new Error(`Deal ${deal.name} is not active`);
          if (deal.validUntil && new Date() > deal.validUntil)
            throw new Error(`Deal ${deal.name} has expired`);
          if (deal.adminId.toString() !== adminId)
            throw new Error(`Deal ${deal.name} does not belong to this admin`);

          const dealQuantity = dealItem.quantity || 1;
          const dealTaxRate = await deal.calculateTax(
            existingOrder.paymentMethod
          );
          const totalDealPrice = dealItem.totalPrice * dealQuantity;
          const totalDealTax = totalDealPrice * (dealTaxRate / 100);

          totalAmount += totalDealPrice;
          totalTax += totalDealTax;
          totalSavings += deal.savings * dealQuantity;

          return {
            dealId: deal._id,
            name: deal.name,
            dealPrice: dealItem.totalPrice,
            customization: dealItem.selectedCustomizations,
            originalPrice: deal.originalPrice * dealQuantity,
            savings: deal.savings * dealQuantity,
            quantity: dealQuantity,
            dealTax: totalDealTax,
            items: deal.items.map((item) => ({
              itemId: item.itemId._id,
              name: item.itemId.name,
              quantity: item.quantity,
              selectedOptions: item.selectedOptions || [],
            })),
          };
        })
      );
    }

    // =====================
    // Push into existing order
    // =====================
    const updatedOrder = await Order.findByIdAndUpdate(
      orderId,
      {
        $push: {
          items: { $each: orderItems },
          deals: { $each: orderDeals },
          kitchenReceipts: {
            items: orderItems,
            deals: orderDeals,
            printedAt: new Date(),
          },
        },
        $inc: {
          totalAmount: totalAmount,
          totalTax: totalTax,
          totalSavings: totalSavings,
          totalVoucherDiscount: totalVoucherDiscount,
        },
      },
      { new: true }
    );

    return res.status(200).json({
      success: true,
      message: "Items and deals added successfully",
      data: updatedOrder,
      newItems: orderItems,
      newDeals: orderDeals,
      totals: { totalAmount, totalTax, totalSavings, totalVoucherDiscount },
    });
  } catch (error) {
    console.error("Error adding items and deals:", error);
    next(error);
  }
};

const printDailySalesReportAndCloseDay = async (req, res, next) => {
  try {
    const adminId = req.user.id;
    const now = new Date();

    const ordersToClose = await Order.find({
      adminId,
      orderStatus: "COMPLETED",
      isEndOfDayClosed: false,
    }).sort({ createdAt: 1 });

    if (ordersToClose.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No new completed orders found to close.",
        dailyReport: {},
      });
    }

    // --- Aggregates ---
    let totalOrdersClosed = 0;
    let totalSalesAmount = 0;
    let totalTaxCollected = 0;
    let totalSavingsGiven = 0;
    let totalVoucherDiscount = 0;

    const itemsSoldSummary = [];
    const dealsSoldSummary = [];

    const paymentMethodSummaryPaid = {
      CASH: 0,
      CARD: 0,
      ONLINE: 0,
      COD: 0,
      on_arrival: 0,
    };

    const paymentMethodSummaryUnpaid = {
      CASH: 0,
      CARD: 0,
      ONLINE: 0,
      COD: 0,
      on_arrival: 0,
    };

    let highestOrderNumberProcessed = 0;

    ordersToClose.forEach((order) => {
      totalOrdersClosed++;
      totalSalesAmount += order.totalAmount || 0;
      totalTaxCollected += order.totalTax || 0;
      totalVoucherDiscount += order.voucherDiscount || 0;
      totalSavingsGiven += order.totalSavings || 0;

      if (order.orderNumber > highestOrderNumberProcessed) {
        highestOrderNumberProcessed = order.orderNumber;
      }

      // --- Items ---
      order.items.forEach((item) => {
        for (let i = 0; i < item.quantity; i++) {
          itemsSoldSummary.push({
            itemId: item.itemId,
            name: item.name,
            price: item.price,
            totalTax: item.totalTax / item.quantity || 0,
            totalDiscount: item.itemDiscount / item.quantity || 0,
          });
        }
      });

      // --- Deals ---
      order.deals.forEach((deal) => {
        for (let i = 0; i < deal.quantity; i++) {
          dealsSoldSummary.push({
            dealId: deal.dealId,
            name: deal.name,
            dealPrice: deal.dealPrice,
            totalTax: deal.dealTax / deal.quantity || 0,
            totalSavings: deal.savings / deal.quantity || 0,
          });
        }
      });

      // --- Payment method split (by paymentStatus) ---
      const paymentTypeKey = order.paymentMethod;
      if (order.paymentStatus === "PAID") {
        if (paymentMethodSummaryPaid.hasOwnProperty(paymentTypeKey)) {
          paymentMethodSummaryPaid[paymentTypeKey] += order.totalAmount || 0;
        }
      } else if (order.paymentStatus === "UNPAID") {
        if (paymentMethodSummaryUnpaid.hasOwnProperty(paymentTypeKey)) {
          paymentMethodSummaryUnpaid[paymentTypeKey] += order.totalAmount || 0;
        }
      }
    });

  //  // --- Mark orders as closed ---
  //   await Order.updateMany(
  //     { _id: { $in: ordersToClose.map((order) => order._id) } },
  //     { $set: { isEndOfDayClosed: true } }
  //   );

  //   // --- Reset Daily Counter ---
  //   const today = new Date();
  //   today.setHours(0, 0, 0, 0);

  //   // Reset counter for specific admin
  //   await Counter.findOneAndUpdate(
  //     { adminId, counterName: "orderNumber" }, // match admin + type of counter
  //     {
  //       $set: {
  //         sequence_value: 0,
  //         last_reset_date: today,
  //       },
  //     },
  //     { upsert: true } // if not exists, create it
  //   );

    // --- Build Sales Report ---
    const salesReport = {
      adminId,
      reportGeneratedDate: now.toISOString().split("T")[0],
      reportGeneratedAt: now,
      totalOrdersClosed,
      totalSalesAmount: parseFloat(totalSalesAmount.toFixed(2)),
      totalTaxCollected: parseFloat(totalTaxCollected.toFixed(2)),
      totalSavingsGiven: parseFloat(totalSavingsGiven.toFixed(2)),
      totalVoucherDiscount: parseFloat(totalVoucherDiscount.toFixed(2)),
      lastOrderNumberInThisReport: highestOrderNumberProcessed,
      itemsSoldSummary: itemsSoldSummary.map((item) => ({
        ...item,
        totalRevenue: parseFloat(item.price.toFixed(2)),
        totalTax: parseFloat(item.totalTax.toFixed(2)),
        totalDiscount: parseFloat(item.totalDiscount.toFixed(2)),
      })),
      dealsSoldSummary: dealsSoldSummary.map((deal) => ({
        ...deal,
        totalRevenue: parseFloat(deal.dealPrice.toFixed(2)),
        totalTax: parseFloat(deal.totalTax.toFixed(2)),
        totalSavings: parseFloat(deal.totalSavings.toFixed(2)),
      })),
      paymentMethodSummary: {
        PAID: {
          CASH: parseFloat(paymentMethodSummaryPaid.CASH.toFixed(2)),
          CARD: parseFloat(paymentMethodSummaryPaid.CARD.toFixed(2)),
          ONLINE: parseFloat(paymentMethodSummaryPaid.ONLINE.toFixed(2)),
          COD: parseFloat(paymentMethodSummaryPaid.COD.toFixed(2)),
          on_arrival: parseFloat(
            paymentMethodSummaryPaid.on_arrival.toFixed(2)
          ),
        },
        UNPAID: {
          CASH: parseFloat(paymentMethodSummaryUnpaid.CASH.toFixed(2)),
          CARD: parseFloat(paymentMethodSummaryUnpaid.CARD.toFixed(2)),
          ONLINE: parseFloat(paymentMethodSummaryUnpaid.ONLINE.toFixed(2)),
          COD: parseFloat(paymentMethodSummaryUnpaid.COD.toFixed(2)),
          on_arrival: parseFloat(
            paymentMethodSummaryUnpaid.on_arrival.toFixed(2)
          ),
        },
      },
    };

    res.status(200).json({
      success: true,
      message:
        "Sales report generated and items marked as closed. Daily counter reset.",
      report: salesReport,
    });
  } catch (error) {
    console.error("Error in printDailySalesReportAndCloseDay:", error);
    next(error);
  }
};

const updateOrder = async (req, res, next) => {
  try {
    const adminId = req.user.id;
    const {
      items,
      deals = [],
      orderId,
      newlyAddedItems = [],
      newlyAddedDeals = [],
      orderStatus,
      paymentStatus,
    } = req.body;
    console.log(req.body);

    // Validate input
    if (!orderId) {
      return res
        .status(400)
        .json({ success: false, message: "Order ID is required" });
    }

    // If only updating payment status or order status, items are not required
    const isStatusOnlyUpdate =
      (paymentStatus || orderStatus) && (!items || items.length === 0);

    if (!isStatusOnlyUpdate && (!items || items.length === 0)) {
      return res.status(400).json({
        success: false,
        message: "Items are required for order updates",
      });
    }

    console.log("Update order request:", {
      orderId,
      itemsCount: items?.length || 0,
      newlyAddedItemsCount: newlyAddedItems.length,
      newlyAddedDealsCount: newlyAddedDeals.length,
    });

    // Handle simple status updates (payment status or order status only)
    if (isStatusOnlyUpdate) {
      console.log("Performing status-only update");

      // Prepare update object for status-only updates
      const statusUpdateData = {};

      if (orderStatus) {
        statusUpdateData.orderStatus = orderStatus;
      }
      if (paymentStatus) {
        statusUpdateData.paymentStatus = paymentStatus;
      }

      // Update the order with only status changes
      const updatedOrder = await Order.findByIdAndUpdate(
        orderId,
        statusUpdateData,
        { new: true }
      );

      if (!updatedOrder) {
        return res
          .status(404)
          .json({ success: false, message: "Order not found" });
      }

      return res.status(200).json({
        success: true,
        message: "Order status updated successfully",
        data: updatedOrder,
      });
    }

    // Continue with full order update logic for item changes...
    console.log("Performing full order update with items");

    // Find the existing order
    const existingOrder = await Order.findById(orderId);
    if (!existingOrder) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    // Get receipt settings
    const receiptSettings = await ReceiptSettings.findOne({});
    let logo = receiptSettings ? receiptSettings.logo : null;

    // If no receipt settings logo, try to get a menu logo as fallback
    if (!logo && items.length > 0) {
      const firstMenuId = items[0].menuId;
      if (firstMenuId) {
        const menu = await Menu.findById(firstMenuId).select("logo");
        if (menu && menu.logo) {
          logo = menu.logo;
        }
      }
    }

    // For newly added items, we need to fetch complete item details including menu information
    const processedNewlyAddedItems = [];
    if (newlyAddedItems.length > 0) {
      for (let newItem of newlyAddedItems) {
        try {
          // Fetch complete item details from database
          const fullItemDetails = await Item.findById(newItem.itemId)
            .populate("categoryId", "name")
            .lean();

          if (fullItemDetails) {
            // Find which menu this item belongs to
            const itemMenu = await Menu.findOne({ itemsID: newItem.itemId })
              .select("name logo")
              .lean();

            processedNewlyAddedItems.push({
              itemId: fullItemDetails._id,
              name: fullItemDetails.name,
              price: fullItemDetails.price,
              quantity: newItem.quantity,
              menuId: itemMenu ? itemMenu._id : null,
              itemDiscount: fullItemDetails.discount || 0,
              itemTax: fullItemDetails.tax?.cash || "0%",
              totalTax: 0,
              options: fullItemDetails.options || [],
              categoryId: fullItemDetails.categoryId._id,
              menuName: itemMenu ? itemMenu.name : "General Items",
              categoryName: fullItemDetails.categoryId.name || "General",
              menuLogo: itemMenu ? itemMenu.logo : null,
            });
          }
        } catch (itemError) {
          console.error(
            `Error fetching details for item ${newItem.itemId}:`,
            itemError
          );
          // Fallback to provided data if database fetch fails
          processedNewlyAddedItems.push({
            ...newItem,
            menuName: newItem.menuName || "General Items",
            categoryName: newItem.categoryName || "General",
            options: newItem.options || [],
          });
        }
      }
    }

    // Process newly added deals if provided
    let processedNewlyAddedDeals = [];
    if (
      newlyAddedDeals &&
      Array.isArray(newlyAddedDeals) &&
      newlyAddedDeals.length > 0
    ) {
      console.log(
        `Processing ${newlyAddedDeals.length} newly added deals for kitchen receipts`
      );
      for (const newDeal of newlyAddedDeals) {
        try {
          // Fetch deal details from database
          const fullDealDetails = await Deal.findById(newDeal.dealId);

          if (fullDealDetails) {
            processedNewlyAddedDeals.push({
              dealId: fullDealDetails._id,
              name: fullDealDetails.name,
              price: fullDealDetails.price,
              quantity: newDeal.quantity,
              description: fullDealDetails.description || "",
              discount: fullDealDetails.discount || 0,
              items: fullDealDetails.items || [],
              validFrom: fullDealDetails.validFrom,
              validUntil: fullDealDetails.validUntil,
            });
          }
        } catch (dealError) {
          console.error(
            `Error fetching details for deal ${newDeal.dealId}:`,
            dealError
          );
          // Fallback to provided data if database fetch fails
          processedNewlyAddedDeals.push({
            ...newDeal,
            description: newDeal.description || "",
            items: newDeal.items || [],
          });
        }
      }
    }

    // Process the updated items
    const orderItems = items.map((item) => {
      // Use the provided item data directly (since it comes from existing order)
      // We don't need to fetch from Item collection for updates
      //me
      return {
        itemId: item.itemId,
        name: item.name || "Item",
        price: item.price || 0,
        quantity: item.quantity,
        menuId: item.menuId || null,
        itemDiscount: item.itemDiscount || 0,
        itemTax: item.itemTax || "0%",
        totalTax: item.totalTax || 0,
        options: item.options || [],
        categoryId: item.categoryId || null,
        menuName: item.menuName || "General Items",
        categoryName: item.categoryName || "General",
      };
    });

    // Calculate total amount for the update

    // Process deals if provided (similar to items processing)
    let orderDeals = [];
    if (deals && Array.isArray(deals)) {
      orderDeals = deals.map((deal) => {
        return {
          dealId: deal.dealId,
          name: deal.name || "Deal",
          dealPrice: deal.dealPrice || 0,
          originalPrice: deal.originalPrice || 0,
          savings: deal.savings || 0,
          quantity: deal.quantity || 1,
          dealTax: deal.dealTax || 0,
          items: deal.items || [],
        };
      });
    }

    // Calculate total amount for items
    const totalItemsAmount = orderItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    // Calculate total amount for deals
    const totalDealsAmount = orderDeals.reduce(
      (sum, deal) => sum + deal.dealPrice * deal.quantity,
      0
    );

    // Calculate the final total by combining items and deals amounts
    const totalAmount = totalItemsAmount + totalDealsAmount;

    // Prepare update object
    const updateData = {
      items: orderItems,
      totalAmount: totalAmount,
    };

    // Add deals to update if they exist
    if (orderDeals.length > 0) {
      updateData.deals = orderDeals;
    }

    // Add status fields if provided
    if (orderStatus) {
      updateData.orderStatus = orderStatus;
    }
    if (paymentStatus) {
      updateData.paymentStatus = paymentStatus;
    }

    // Update the order with new items and total (replace all items)
    const updatedOrder = await Order.findByIdAndUpdate(orderId, updateData, {
      new: true,
    });

    // Generate kitchen receipts grouped by menu
    const itemsByMenu = orderItems.reduce((groups, item) => {
      const menuKey = item.menuId || `name-${item.menuName || "General Items"}`;
      const menuName = item.menuName || "General Items";

      if (!groups[menuKey]) {
        groups[menuKey] = {
          menuId: item.menuId,
          menuName,
          items: [],
          totalAmount: 0,
        };
      }

      groups[menuKey].items.push(item);
      groups[menuKey].totalAmount += item.price * item.quantity;

      return groups;
    }, {});

    const menuGroups = Object.values(itemsByMenu);

    // Generate kitchen receipts for updated order
    const kitchenReceipts = menuGroups.map((menuGroup) => {
      const kitchenItems = menuGroup.items.map((item) => {
        const { itemId, name, quantity, options, menuName } = item;
        return { itemId, name, quantity, options, menuName };
      });

      return {
        logo,
        _id: updatedOrder._id,
        menuId: menuGroup.menuId,
        menuName: menuGroup.menuName,
        items: kitchenItems,
        printedAt: new Date(),
        customerName: updatedOrder.customerInfo?.name || null,
        orderType: updatedOrder.orderType,
      };
    });

    // Generate separate kitchen receipts for newly added items only
    let newKitchenReceipts = [];
    if (processedNewlyAddedItems.length > 0) {
      const newItemsByMenu = processedNewlyAddedItems.reduce((groups, item) => {
        const menuKey =
          item.menuId || `name-${item.menuName || "General Items"}`;
        const menuName = item.menuName || "General Items";

        if (!groups[menuKey]) {
          groups[menuKey] = {
            menuId: item.menuId,
            menuName,
            menuLogo: item.menuLogo,
            items: [],
            totalAmount: 0,
          };
        }

        groups[menuKey].items.push(item);
        groups[menuKey].totalAmount += item.price * item.quantity;

        return groups;
      }, {});

      const newMenuGroups = Object.values(newItemsByMenu);

      newKitchenReceipts = newMenuGroups.map((menuGroup) => {
        const kitchenItems = menuGroup.items.map((item) => {
          const { itemId, name, quantity, options, menuName } = item;
          return { itemId, name, quantity, options, menuName };
        });

        return {
          logo: menuGroup.menuLogo || logo,
          _id: updatedOrder._id,
          menuId: menuGroup.menuId,
          menuName: menuGroup.menuName,
          items: kitchenItems,
          printedAt: new Date(),
          customerName: updatedOrder.customerInfo?.name || null,
          orderType: updatedOrder.orderType,
          isNewlyAdded: true,
        };
      });
    }

    // Generate separate kitchen receipts for newly added deals
    if (processedNewlyAddedDeals.length > 0) {
      const dealKitchenReceipts = processedNewlyAddedDeals.map((deal) => {
        const dealItems = deal.items.map((item) => {
          return {
            itemId: item.itemId,
            name: item.name,
            quantity: item.quantity,
            menuName: "Deal Items",
          };
        });

        return {
          logo: logo,
          _id: updatedOrder._id,
          menuId: null,
          menuName: "Deals",
          deals: [
            {
              dealId: deal.dealId,
              name: deal.name,
              quantity: deal.quantity,
              items: dealItems,
            },
          ],
          items: [], // No direct items for deal receipts
          printedAt: new Date(),
          customerName: updatedOrder.customerInfo?.name || null,
          orderType: updatedOrder.orderType,
          isNewlyAdded: true,
          isDealReceipt: true,
        };
      });

      // Add deal receipts to newKitchenReceipts
      newKitchenReceipts = [...newKitchenReceipts, ...dealKitchenReceipts];
    }
    if (newKitchenReceipts.length > 0) {
      await Order.findByIdAndUpdate(
        orderId,
        { $push: { kitchenReceipts: { $each: newKitchenReceipts } } },
        { new: true }
      );
    }
    return res.status(200).json({
      success: true,
      message: "Order updated successfully",
      data: updatedOrder,
      kitchenReceipts,
      newKitchenReceipts,
    });
  } catch (error) {
    next(error);
  }
};

// Complete Order and Generate Unpaid Receipts For Dine-In Customers
const completeOrder = async (req, res, next) => {
  try {
    const {
      orderId,
      paymentMethod,
      paymentStatus = "UNPAID",
      orderStatus = "COMPLETED",
      finalTotal,
      tax,
      voucherCode,
      voucherDiscount = 0,
      items,
    } = req.body;

    console.log("Complete order request:", req.body);

    // Find the existing order
    const existingOrder = await Order.findById(orderId);
    if (!existingOrder) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    // Calculate pricing details
    let originalTotal = 0;
    let itemDiscounts = 0;
    let subtotal = 0;

    // Use provided items or existing order items
    const orderItems = items || existingOrder.items;

    // Calculate totals from items
    orderItems.forEach((item) => {
      const itemTotal = item.price * item.quantity;
      originalTotal += itemTotal;

      // Calculate item discount if item has discount
      if (item.discount) {
        const discount = (item.discount / 100) * itemTotal;
        itemDiscounts += discount;
      }
    });

    subtotal = originalTotal - itemDiscounts;

    // Parse tax and voucher values
    const taxAmount = parseFloat(tax) || 0;
    const voucherDiscountAmount = parseFloat(voucherDiscount) || 0;
    const calculatedFinalTotal = subtotal + taxAmount - voucherDiscountAmount;
    const totalSavings = itemDiscounts + voucherDiscountAmount;

    // Create pricing details object
    const pricingDetails = {
      originalTotal: originalTotal.toFixed(2),
      itemDiscounts: itemDiscounts.toFixed(2),
      subtotal: subtotal.toFixed(2),
      voucherDiscount: voucherDiscountAmount.toFixed(2),
      tax: taxAmount.toFixed(2),
      finalTotal: (finalTotal || calculatedFinalTotal).toFixed(2),
      totalSavings: totalSavings.toFixed(2),
    };

    console.log("Calculated pricing details:", pricingDetails);

    // Update the order with complete information
    const updatedOrder = await Order.findByIdAndUpdate(
      orderId,
      {
        orderStatus: orderStatus,
        paymentMethod: paymentMethod,
        paymentStatus: paymentStatus,
        totalAmount: parseFloat(pricingDetails.finalTotal),
        voucherDiscount: voucherDiscountAmount,
        items: orderItems, // Update items if provided
      },
      { new: true }
    );

    // Get existing customer receipts and update them with detailed pricing
    let customerReceipts = await Receipt.find({
      adminId: existingOrder.adminId,
      // Since Receipt model doesn't have orderId, we'll find by other criteria
      $or: [
        { orderId: orderId }, // If orderId field exists in some receipts
        {
          adminId: existingOrder.adminId,
          printedAt: {
            $gte: new Date(existingOrder.printedAt.getTime() - 60000), // Within 1 minute of order creation
            $lte: new Date(existingOrder.printedAt.getTime() + 60000),
          },
        },
      ],
    });

    // If no receipts found, create new ones
    if (!customerReceipts || customerReceipts.length === 0) {
      // Get receipt settings for logo
      const receiptSettings = await ReceiptSettings.findOne({});
      let logo = receiptSettings ? receiptSettings.logo : null;

      // If no receipt settings logo, try to get a menu logo as fallback
      // Also get the first available menuId for consolidated receipt
      let fallbackMenuId = null;
      if (!logo && orderItems && orderItems.length > 0) {
        const firstMenuId = orderItems[0].menuId;
        fallbackMenuId = firstMenuId; // Store for use in receipt
        if (firstMenuId) {
          const menu = await Menu.findById(firstMenuId).select("logo");
          if (menu && menu.logo) {
            logo = menu.logo;
          }
        }
      } else if (orderItems && orderItems.length > 0) {
        // If logo exists but we still need menuId
        fallbackMenuId = orderItems[0].menuId;
      }

      // If no menuId found in items, find any menu for this admin as fallback
      if (!fallbackMenuId) {
        const anyMenu = await Menu.findOne({
          adminId: existingOrder.adminId,
        }).select("_id");
        if (anyMenu) {
          fallbackMenuId = anyMenu._id;
        }
      }

      // Create consolidated customer receipt with detailed pricing
      const consolidatedCustomerReceipt = await Receipt.create({
        adminId: existingOrder.adminId,
        orderId: orderId, // Add orderId for future reference
        menuId: fallbackMenuId,
        menuName: "Complete Order",
        items: orderItems,
        deals: existingOrder.deals
          ? existingOrder.deals.map((deal) => ({
              dealId: deal.dealId,
              name: deal.name,
              dealPrice: deal.dealPrice,
              originalPrice: deal.originalPrice,
              savings: deal.savings,
              quantity: deal.quantity,
              items: deal.items || [],
            }))
          : [],
        totalAmount: parseFloat(pricingDetails.finalTotal),
        itemDiscount: parseFloat(pricingDetails.itemDiscounts),
        originalAmount: parseFloat(pricingDetails.originalTotal),
        logo: logo,
        orderType: existingOrder.orderType,
        totalTax: parseFloat(pricingDetails.tax),
        paymentType: paymentMethod,
        paymentMethod: paymentMethod,
        paymentStatus: paymentStatus,
        printedAt: new Date(),
        customerInfo: existingOrder.customerInfo,

        // Add detailed pricing breakdown
        pricingDetails: pricingDetails,
        subtotal: parseFloat(pricingDetails.subtotal),
        voucherDiscount: parseFloat(pricingDetails.voucherDiscount),
        voucherCode: voucherCode,
        finalTotal: parseFloat(pricingDetails.finalTotal),
        totalSavings: parseFloat(pricingDetails.totalSavings),
      });

      customerReceipts = [consolidatedCustomerReceipt];
    } else {
      // Update existing receipts with detailed pricing information
      customerReceipts = await Promise.all(
        customerReceipts.map(async (receipt) => {
          const updatedReceipt = await Receipt.findByIdAndUpdate(
            receipt._id,
            {
              totalAmount: parseFloat(pricingDetails.finalTotal),
              itemDiscount: parseFloat(pricingDetails.itemDiscounts),
              originalAmount: parseFloat(pricingDetails.originalTotal),
              totalTax: parseFloat(pricingDetails.tax),
              paymentMethod: paymentMethod,
              paymentStatus: paymentStatus,

              // Add detailed pricing breakdown
              pricingDetails: pricingDetails,
              subtotal: parseFloat(pricingDetails.subtotal),
              voucherDiscount: parseFloat(pricingDetails.voucherDiscount),
              voucherCode: voucherCode,
              finalTotal: parseFloat(pricingDetails.finalTotal),
              totalSavings: parseFloat(pricingDetails.totalSavings),
            },
            { new: true }
          );
          return updatedReceipt;
        })
      );
    }

    // Create comprehensive response data
    const responseData = {
      ...updatedOrder.toObject(),
      pricingDetails: pricingDetails,
      breakdown: {
        originalTotal: pricingDetails.originalTotal,
        itemDiscounts: pricingDetails.itemDiscounts,
        subtotal: pricingDetails.subtotal,
        voucherDiscount: pricingDetails.voucherDiscount,
        tax: pricingDetails.tax,
        finalTotal: pricingDetails.finalTotal,
        totalSavings: pricingDetails.totalSavings,
      },
    };

    return res.status(200).json({
      success: true,
      message: "Order completed successfully And Unpaid Receipts Generated",
      data: responseData,
      customerReceipts: customerReceipts,
      totalSavings: pricingDetails.totalSavings,
      appliedVoucher: voucherCode
        ? {
            code: voucherCode,
            discount: pricingDetails.voucherDiscount,
          }
        : null,
    });
  } catch (error) {
    console.error("Complete order error:", error);
    next(error);
  }
};

const getPayment = async (req, res, next) => {
  try {
    const { orderId, voucherCode, paymentType, paymentMode, cardDetails } =
      req.body;

    const order = await Order.findById(orderId);
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    // Get receipt settings
    const receiptSettings = await ReceiptSettings.findOne({});
    let logo = receiptSettings ? receiptSettings.logo : null;

    // If no receipt settings logo, get the order to find menu logo as fallback
    if (!logo) {
      const order = await Order.findById(orderId);
      if (order && order.items && order.items.length > 0) {
        const firstMenuId = order.items[0].menuId;
        if (firstMenuId) {
          const menu = await Menu.findById(firstMenuId).select("logo");
          if (menu && menu.logo) {
            logo = menu.logo;
          }
        }
      }
    }

    // Find existing receipts or generate them from order data
    let receipts = await Receipt.find({ orderId });

    // If no receipts exist, generate them from the order
    if (!receipts || receipts.length === 0) {
      // Group order items by menu for receipt generation
      const itemsByMenu = order.items.reduce((groups, item) => {
        const menuKey =
          item.menuId || `name-${item.menuName || "General Items"}`;
        const menuName = item.menuName || "General Items";

        if (!groups[menuKey]) {
          groups[menuKey] = {
            menuId: item.menuId,
            menuName,
            items: [],
            totalAmount: 0,
          };
        }

        groups[menuKey].items.push(item);
        groups[menuKey].totalAmount += item.price * item.quantity;

        return groups;
      }, {});

      const menuGroups = Object.values(itemsByMenu);

      // Create receipts for each menu group
      for (const menuGroup of menuGroups) {
        const totalItemDiscount = menuGroup.items.reduce(
          (acc, item) => acc + (item.itemDiscount || 0) * item.quantity,
          0
        );
        const totalTax = menuGroup.items.reduce(
          (acc, item) => acc + (item.totalTax || 0),
          0
        );
        const menuFinalAmount = Math.max(
          0,
          menuGroup.totalAmount - totalItemDiscount + totalTax
        );

        const newReceipt = await Receipt.create({
          adminId: order.adminId,
          orderId: order._id,
          menuId: menuGroup.menuId,
          menuName: menuGroup.menuName,
          items: menuGroup.items,
          totalAmount: menuFinalAmount,
          itemDiscount: totalItemDiscount,
          originalAmount: menuGroup.totalAmount,
          logo,
          orderType: order.orderType,
          totalTax,
          paymentType: order.paymentType,
          paymentMethod: order.paymentMethod,
          printedAt: new Date(),
          paymentStatus: "UNPAID",
        });

        receipts.push(newReceipt);
      }
    }

    const voucher = await Voucher.findOne({ code: voucherCode });

    // Update payment details
    if (paymentType === "CARD") {
      order.paymentType = paymentType;
      order.paymentStatus = "PAID";
      if (cardDetails) order.cardDetails = cardDetails;

      receipts.forEach((receipt) => {
        receipt.paymentType = paymentType;
        receipt.paymentStatus = "PAID";
        if (cardDetails) receipt.cardDetails = cardDetails;
      });
    } else if (paymentType === "ONLINE") {
      order.paymentType = paymentType;
      order.paymentStatus = "PAID";
      order.paymentMode = paymentMode;

      receipts.forEach((receipt) => {
        receipt.paymentType = paymentType;
        receipt.paymentStatus = "PAID";
        receipt.paymentMode = paymentMode;
      });
    } else if (paymentType === "CASH") {
      order.paymentType = paymentType;
      order.paymentStatus = "PAID";

      receipts.forEach((receipt) => {
        receipt.paymentType = paymentType;
        receipt.paymentStatus = "PAID";
      });
    }

    // Voucher application
    if (voucher && voucher.applyOnce === true) {
      const matchedReceipts = receipts.filter(
        (receipt) => receipt.menuId?.toString() === voucher.menuId.toString()
      );

      voucher.applyOnce = false;

      matchedReceipts.forEach((receipt) => {
        receipt.totalAmount -= voucher.voucherPrice;
        receipt.itemDiscount = receipt.itemDiscount + voucher.voucherPrice;
        receipt.voucherDiscount = voucher.voucherPrice;
        order.totalAmount -= voucher.voucherPrice;
        order.voucherDiscount = voucher.voucherPrice;
      });

      await voucher.save();
    }

    // Save order and receipts
    await order.save();
    await Promise.all(receipts.map((receipt) => receipt.save())); // save each receipt

    return res.status(200).json({
      success: true,
      message: "Get Payment Successfully and PAID Recipts generated",
      PaidReceipts: receipts,
    });
  } catch (error) {
    next(error);
  }
};

const generateCustomerReceipts = async (req, res, next) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res
        .status(400)
        .json({ success: false, message: "Order ID is required" });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    // Get receipt settings
    const receiptSettings = await ReceiptSettings.findOne({});
    let logo = receiptSettings ? receiptSettings.logo : null;

    // If no receipt settings logo, try to get a menu logo as fallback
    if (!logo && order.items && order.items.length > 0) {
      const firstMenuId = order.items[0].menuId;
      if (firstMenuId) {
        const menu = await Menu.findById(firstMenuId).select("logo");
        if (menu && menu.logo) {
          logo = menu.logo;
        }
      }
    }

    // Group order items by menu for receipt generation
    const itemsByMenu = order.items.reduce((groups, item) => {
      const menuKey = item.menuId || `name-${item.menuName || "General Items"}`;
      const menuName = item.menuName || "General Items";

      if (!groups[menuKey]) {
        groups[menuKey] = {
          menuId: item.menuId,
          menuName,
          items: [],
          totalAmount: 0,
        };
      }

      groups[menuKey].items.push(item);
      groups[menuKey].totalAmount += item.price * item.quantity;

      return groups;
    }, {});

    const menuGroups = Object.values(itemsByMenu);

    // Get menu logos for each menu group
    const menuLogos = {};
    for (const menuGroup of menuGroups) {
      if (menuGroup.menuId) {
        const menu = await Menu.findById(menuGroup.menuId).select("logo");
        if (menu && menu.logo) {
          menuLogos[menuGroup.menuId] = menu.logo;
        }
      }
    }

    // Generate consolidated customer receipt with all items
    const allCustomerItems = [];
    let totalCustomerAmount = 0;
    let totalCustomerDiscount = 0;
    let totalCustomerTax = 0;
    let totalOriginalAmount = 0;

    menuGroups.forEach((menuGroup) => {
      const menuItemDiscount = menuGroup.items.reduce(
        (acc, item) => acc + (item.itemDiscount || 0) * item.quantity,
        0
      );
      const menuTax = menuGroup.items.reduce(
        (acc, item) => acc + (item.totalTax || 0),
        0
      );
      const menuFinalAmount = Math.max(
        0,
        menuGroup.totalAmount - menuItemDiscount + menuTax
      );

      allCustomerItems.push(...menuGroup.items);
      totalCustomerAmount += menuFinalAmount;
      totalCustomerDiscount += menuItemDiscount;
      totalCustomerTax += menuTax;
      totalOriginalAmount += menuGroup.totalAmount + menuTax;
    });

    const consolidatedCustomerReceipt = {
      logo,
      _id: order._id,
      menuId: null, // No specific menu since it contains items from multiple menus
      menuName: "Complete Order",
      items: allCustomerItems.map((item) => ({
        ...item,
        // Ensure menu name is included for each item
        menuName: item.menuName || "General Items",
      })),
      totalAmount: totalCustomerAmount,
      itemDiscount: totalCustomerDiscount,
      totalTax: totalCustomerTax,
      paymentStatus: order.paymentStatus,
      originalAmount: totalOriginalAmount,
      printedAt: new Date(),
      paymentMethod: order.paymentMethod,
      paymentType: order.paymentType,
      orderType: order.orderType,
      customerInfo: order.customerInfo,
      // Include menu information for display with logos
      menuGroups: menuGroups.map((menuGroup) => ({
        menuId: menuGroup.menuId,
        menuName: menuGroup.menuName,
        menuLogo: menuGroup.menuId ? menuLogos[menuGroup.menuId] : null,
        itemCount: menuGroup.items.length,
        totalAmount: menuGroup.totalAmount,
      })),
    };

    return res.status(200).json({
      success: true,
      message: "Consolidated customer receipt generated",
      customerReceipts: [consolidatedCustomerReceipt],
    });
  } catch (error) {
    next(error);
  }
};

const getAllOrders = async (req, res, next) => {
  try {
    const adminId = req.user.id;

    // pagination values
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // count total orders for this admin
    const totalOrders = await Order.countDocuments({ adminId });

    // Get all orders for this admin with comprehensive item details
    const orders = await Order.find({ adminId })
      .sort({ createdAt: -1 }) // Sort by newest first
      .skip(skip)
      .limit(limit)
      .lean(); // Use lean for better performance

    // Populate each order's items with complete data from Item collection
    const ordersWithCompleteItems = await Promise.all(
      orders.map(async (order) => {
        if (!order.items || order.items.length === 0) {
          return order;
        }

        // Fetch complete item details for each item in the order
        const completeItems = await Promise.all(
          order.items.map(async (orderItem) => {
            try {
              // Get full item details from Item collection
              const fullItem = await Item.findById(orderItem.itemId)
                .populate("categoryId", "name")
                .lean();

              if (!fullItem) {
                // If item not found, return order item as is
                return orderItem;
              }

              // Get menu information
              let menuInfo = null;
              if (orderItem.menuId) {
                const menu = await Menu.findById(orderItem.menuId)
                  .select("name logo")
                  .lean();
                if (menu) {
                  menuInfo = {
                    menuId: menu._id,
                    menuName: menu.name,
                    menuLogo: menu.logo,
                  };
                }
              }

              // Combine order item data with complete item details
              return {
                // Core identification
                _id: fullItem._id,
                itemId: fullItem._id,

                // Names and display
                name: fullItem.name,
                originalName: fullItem.name,

                // Admin and category information
                adminId: fullItem.adminId,
                categoryId: fullItem.categoryId?._id || fullItem.categoryId,
                categoryName: fullItem.categoryId?.name || "General",

                // Menu information
                menuId: orderItem.menuId || null,
                menuName:
                  orderItem.menuName || menuInfo?.menuName || "General Items",
                menuLogo: menuInfo?.menuLogo || null,

                // Timestamps and versioning
                createdAt: fullItem.createdAt,
                updatedAt: fullItem.updatedAt,
                __v: fullItem.__v,

                // Pricing information
                originalPrice: fullItem.originalPrice || fullItem.price,
                price: orderItem.price || fullItem.price,
                basePrice: fullItem.price,
                totalPrice: fullItem.totalPrice || fullItem.price,

                // Discount information
                discount: fullItem.discount || 0,
                itemDiscount: orderItem.itemDiscount || fullItem.discount || 0,

                // Tax information
                tax: fullItem.tax || { cash: "0", card: "0" },
                itemTax: orderItem.itemTax || fullItem.tax?.cash || "0",
                cashTax: fullItem.tax?.cash || "0",
                cardTax: fullItem.tax?.card || "0",
                totalTax: orderItem.totalTax || 0,

                // Options information
                options: fullItem.options || [],
                selectedOptions:
                  orderItem.options || orderItem.selectedOptions || [],

                // Media and visual
                pictureURL: fullItem.pictureURL || "",

                // Order-specific data
                quantity: orderItem.quantity,
                paymentMethod: orderItem.paymentMethod,
                paymentType: orderItem.paymentType,

                // Additional calculated fields
                itemSubtotal:
                  (orderItem.price || fullItem.price) * orderItem.quantity,
                itemTotalAfterDiscount:
                  ((orderItem.price || fullItem.price) -
                    (fullItem.discount || 0)) *
                  orderItem.quantity,
                finalItemPrice:
                  (orderItem.price || fullItem.price) -
                  (fullItem.discount || 0),

                // Status and metadata
                status: "active",
                isNewlyAdded: false,
              };
            } catch (itemError) {
              console.error(
                `Error fetching item details for ${orderItem.itemId}:`,
                itemError
              );
              // Return original order item if fetch fails
              return {
                ...orderItem,
                _id: orderItem.itemId,
                adminId: adminId,
                categoryId: null,
                categoryName: "General",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                __v: 0,
                originalPrice: orderItem.price || 0,
                basePrice: orderItem.price || 0,
                totalPrice: orderItem.price || 0,
                discount: 0,
                itemDiscount: orderItem.itemDiscount || 0,
                tax: { cash: "0", card: "0" },
                cashTax: "0",
                cardTax: "0",
                options: [],
                selectedOptions: orderItem.options || [],
                pictureURL: "",
                itemSubtotal: (orderItem.price || 0) * orderItem.quantity,
                itemTotalAfterDiscount:
                  (orderItem.price || 0) * orderItem.quantity,
                finalItemPrice: orderItem.price || 0,
                status: "active",
                isNewlyAdded: false,
              };
            }
          })
        );

        return {
          ...order,
          items: completeItems,
          deals: order.deals
            ? order.deals.map((deal) => ({
                ...deal,
                items: deal.items
                  ? deal.items.map((item) => ({
                      ...item,
                      selectedOptions: item.selectedOptions || [],
                    }))
                  : [],
              }))
            : [],
        };
      })
    );

    console.log(
      `Fetched ${ordersWithCompleteItems.length} orders with complete item details`
    );

    res.status(200).json({
      success: true,
      currentPage: page,
      totalPages: Math.ceil(totalOrders / limit),
      totalOrders,
      data: ordersWithCompleteItems,
      message: `Retrieved ${ordersWithCompleteItems.length} orders with comprehensive item data`,
    });
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch orders",
      error: error.message,
    });
  }
};

const deleteOrder = async (req, res, next) => {
  try {
    const { id } = req.body; // Get order ID from request body

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required",
      });
    }

    // Find and delete the order for the logged-in admin
    const deletedOrder = await Order.findOneAndDelete({
      _id: id,
      adminId: req.user.id,
    });

    if (!deletedOrder) {
      return res.status(404).json({
        success: false,
        message: "Order not found or you don't have permission to delete it",
      });
    }

    res.status(200).json({
      success: true,
      message: "Order deleted successfully",
      data: deletedOrder,
    });
  } catch (error) {
    console.error("Error deleting order:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete order",
      error: error.message,
    });
  }
};

// const getAllOrders = async (req, res, next) => {
//   try {
//     const adminId = req.user.id;

//     // Get all orders for this admin with comprehensive item details
//     const orders = await Order.find({ adminId })
//       .sort({ createdAt: -1 }) // Sort by newest first
//       .lean(); // Use lean for better performance

//     // Populate each order's items with complete data from Item collection
//     const ordersWithCompleteItems = await Promise.all(
//       orders.map(async (order) => {
//         if (!order.items || order.items.length === 0) {
//           return order;
//         }

//         // Fetch complete item details for each item in the order
//         const completeItems = await Promise.all(
//           order.items.map(async (orderItem) => {
//             try {
//               // Get full item details from Item collection
//               const fullItem = await Item.findById(orderItem.itemId)
//                 .populate("categoryId", "name")
//                 .lean();

//               if (!fullItem) {
//                 // If item not found, return order item as is
//                 return orderItem;
//               }

//               // Get menu information
//               let menuInfo = null;
//               if (orderItem.menuId) {
//                 const menu = await Menu.findById(orderItem.menuId)
//                   .select("name logo")
//                   .lean();
//                 if (menu) {
//                   menuInfo = {
//                     menuId: menu._id,
//                     menuName: menu.name,
//                     menuLogo: menu.logo,
//                   };
//                 }
//               }

//               // Combine order item data with complete item details
//               return {
//                 // Core identification
//                 _id: fullItem._id,
//                 itemId: fullItem._id,

//                 // Names and display
//                 name: fullItem.name,
//                 originalName: fullItem.name,

//                 // Admin and category information
//                 adminId: fullItem.adminId,
//                 categoryId: fullItem.categoryId?._id || fullItem.categoryId,
//                 categoryName: fullItem.categoryId?.name || "General",

//                 // Menu information
//                 menuId: orderItem.menuId || null,
//                 menuName:
//                   orderItem.menuName || menuInfo?.menuName || "General Items",
//                 menuLogo: menuInfo?.menuLogo || null,

//                 // Timestamps and versioning
//                 createdAt: fullItem.createdAt,
//                 updatedAt: fullItem.updatedAt,
//                 __v: fullItem.__v,

//                 // Pricing information
//                 originalPrice: fullItem.originalPrice || fullItem.price,
//                 price: orderItem.price || fullItem.price,
//                 basePrice: fullItem.price,
//                 totalPrice: fullItem.totalPrice || fullItem.price,

//                 // Discount information
//                 discount: fullItem.discount || 0,
//                 itemDiscount: orderItem.itemDiscount || fullItem.discount || 0,

//                 // Tax information
//                 tax: fullItem.tax || { cash: "0", card: "0" },
//                 itemTax: orderItem.itemTax || fullItem.tax?.cash || "0",
//                 cashTax: fullItem.tax?.cash || "0",
//                 cardTax: fullItem.tax?.card || "0",
//                 totalTax: orderItem.totalTax || 0,

//                 // Options information
//                 options: fullItem.options || [],
//                 selectedOptions:
//                   orderItem.options || orderItem.selectedOptions || [],

//                 // Media and visual
//                 pictureURL: fullItem.pictureURL || "",

//                 // Order-specific data
//                 quantity: orderItem.quantity,
//                 paymentMethod: orderItem.paymentMethod,
//                 paymentType: orderItem.paymentType,

//                 // Additional calculated fields
//                 itemSubtotal:
//                   (orderItem.price || fullItem.price) * orderItem.quantity,
//                 itemTotalAfterDiscount:
//                   ((orderItem.price || fullItem.price) -
//                     (fullItem.discount || 0)) *
//                   orderItem.quantity,
//                 finalItemPrice:
//                   (orderItem.price || fullItem.price) -
//                   (fullItem.discount || 0),

//                 // Status and metadata
//                 status: "active",
//                 isNewlyAdded: false,
//               };
//             } catch (itemError) {
//               console.error(
//                 `Error fetching item details for ${orderItem.itemId}:`,
//                 itemError
//               );
//               // Return original order item if fetch fails
//               return {
//                 ...orderItem,
//                 _id: orderItem.itemId,
//                 adminId: adminId,
//                 categoryId: null,
//                 categoryName: "General",
//                 createdAt: new Date().toISOString(),
//                 updatedAt: new Date().toISOString(),
//                 __v: 0,
//                 originalPrice: orderItem.price || 0,
//                 basePrice: orderItem.price || 0,
//                 totalPrice: orderItem.price || 0,
//                 discount: 0,
//                 itemDiscount: orderItem.itemDiscount || 0,
//                 tax: { cash: "0", card: "0" },
//                 cashTax: "0",
//                 cardTax: "0",
//                 options: [],
//                 selectedOptions: orderItem.options || [],
//                 pictureURL: "",
//                 itemSubtotal: (orderItem.price || 0) * orderItem.quantity,
//                 itemTotalAfterDiscount:
//                   (orderItem.price || 0) * orderItem.quantity,
//                 finalItemPrice: orderItem.price || 0,
//                 status: "active",
//                 isNewlyAdded: false,
//               };
//             }
//           })
//         );

//         return {
//           ...order,
//           items: completeItems,
//           deals: order.deals
//             ? order.deals.map((deal) => ({
//                 ...deal,
//                 items: deal.items
//                   ? deal.items.map((item) => ({
//                       ...item,
//                       selectedOptions: item.selectedOptions || [],
//                     }))
//                   : [],
//               }))
//             : [],
//         };
//       })
//     );

//     console.log(
//       `Fetched ${ordersWithCompleteItems.length} orders with complete item details`
//     );

//     res.status(200).json({
//       success: true,
//       data: ordersWithCompleteItems,
//       message: `Retrieved ${ordersWithCompleteItems.length} orders with comprehensive item data`,
//     });
//   } catch (error) {
//     console.error("Error fetching orders:", error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to fetch orders",
//       error: error.message,
//     });
//   }
// };

// New function to get orders for a specific admin (for Super Admin analytics)
const getOrdersForAdmin = async (req, res, next) => {
  try {
    const adminId = req.params.adminId;

    if (!adminId) {
      return res.status(400).json({
        success: false,
        message: "Admin ID is required",
      });
    }

    // Get all orders for this admin with comprehensive item details
    const orders = await Order.find({ adminId })
      .sort({ createdAt: -1 }) // Sort by newest first
      .lean(); // Use lean for better performance

    // Populate each order's items with complete data from Item collection
    const ordersWithCompleteItems = await Promise.all(
      orders.map(async (order) => {
        if (!order.items || order.items.length === 0) {
          return order;
        }

        // Fetch complete item details for each item in the order
        const completeItems = await Promise.all(
          order.items.map(async (orderItem) => {
            try {
              // Get full item details from Item collection
              const fullItem = await Item.findById(orderItem.itemId)
                .populate("categoryId", "name")
                .lean();

              if (!fullItem) {
                // If item not found, return order item as is
                return orderItem;
              }

              // Get menu information
              let menuInfo = null;
              if (orderItem.menuId) {
                const menu = await Menu.findById(orderItem.menuId)
                  .select("name logo")
                  .lean();
                if (menu) {
                  menuInfo = {
                    menuId: menu._id,
                    menuName: menu.name,
                    menuLogo: menu.logo,
                  };
                }
              }

              // Combine order item data with complete item details
              return {
                // Core identification
                _id: fullItem._id,
                itemId: fullItem._id,

                // Names and display
                name: fullItem.name,
                originalName: fullItem.name,

                // Admin and category information
                adminId: fullItem.adminId,
                categoryId: fullItem.categoryId?._id || fullItem.categoryId,
                categoryName: fullItem.categoryId?.name || "General",

                // Menu information
                menuId: orderItem.menuId || null,
                menuName:
                  orderItem.menuName || menuInfo?.menuName || "General Items",
                menuLogo: menuInfo?.menuLogo || null,

                // Timestamps and versioning
                createdAt: fullItem.createdAt,
                updatedAt: fullItem.updatedAt,
                __v: fullItem.__v,

                // Pricing information
                originalPrice: fullItem.originalPrice || fullItem.price,
                price: orderItem.price || fullItem.price,
                basePrice: fullItem.price,
                totalPrice: fullItem.totalPrice || fullItem.price,

                // Discount information
                discount: fullItem.discount || 0,
                itemDiscount: orderItem.itemDiscount || fullItem.discount || 0,

                // Tax information
                tax: fullItem.tax || { cash: "0", card: "0" },
                itemTax: orderItem.itemTax || fullItem.tax?.cash || "0",
                cashTax: fullItem.tax?.cash || "0",
                cardTax: fullItem.tax?.card || "0",
                totalTax: orderItem.totalTax || 0,

                // Options information
                options: fullItem.options || [],
                selectedOptions:
                  orderItem.options || orderItem.selectedOptions || [],

                // Media and visual
                pictureURL: fullItem.pictureURL || "",

                // Order-specific data
                quantity: orderItem.quantity,
                paymentMethod: orderItem.paymentMethod,
                paymentType: orderItem.paymentType,

                // Additional calculated fields
                itemSubtotal:
                  (orderItem.price || fullItem.price) * orderItem.quantity,
                itemTotalAfterDiscount:
                  ((orderItem.price || fullItem.price) -
                    (fullItem.discount || 0)) *
                  orderItem.quantity,
                finalItemPrice:
                  (orderItem.price || fullItem.price) -
                  (fullItem.discount || 0),

                // Status and metadata
                status: "active",
                isNewlyAdded: false,
              };
            } catch (itemError) {
              console.error(
                `Error fetching item details for ${orderItem.itemId}:`,
                itemError
              );
              // Return original order item if fetch fails
              return {
                ...orderItem,
                _id: orderItem.itemId,
                adminId: adminId,
                categoryId: null,
                categoryName: "General",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                __v: 0,
                originalPrice: orderItem.price || 0,
                basePrice: orderItem.price || 0,
                totalPrice: orderItem.price || 0,
                discount: 0,
                itemDiscount: orderItem.itemDiscount || 0,
                tax: { cash: "0", card: "0" },
                cashTax: "0",
                cardTax: "0",
                options: [],
                selectedOptions: orderItem.options || [],
                pictureURL: "",
                itemSubtotal: (orderItem.price || 0) * orderItem.quantity,
                itemTotalAfterDiscount:
                  (orderItem.price || 0) * orderItem.quantity,
                finalItemPrice: orderItem.price || 0,
                status: "active",
                isNewlyAdded: false,
              };
            }
          })
        );

        return {
          ...order,
          items: completeItems,
        };
      })
    );

    console.log(
      `Fetched ${ordersWithCompleteItems.length} orders for admin ${adminId}`
    );

    res.status(200).json({
      success: true,
      data: ordersWithCompleteItems,
      message: `Retrieved ${ordersWithCompleteItems.length} orders for admin`,
    });
  } catch (error) {
    console.error("Error fetching orders for admin:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch orders for admin",
      error: error.message,
    });
  }
};

// Excel export function for orders
const exportOrdersToExcel = async (req, res, next) => {
  try {
    const adminId = req.params.adminId;

    if (!adminId) {
      return res.status(400).json({
        success: false,
        message: "Admin ID is required",
      });
    }

    // Get all orders for this admin with comprehensive item details (same as getOrdersForAdmin)
    const orders = await Order.find({ adminId })
      .sort({ createdAt: -1 }) // Sort by newest first
      .lean(); // Use lean for better performance

    // Populate each order's items with complete data from Item collection (same logic as getOrdersForAdmin)
    const ordersWithCompleteItems = await Promise.all(
      orders.map(async (order) => {
        if (!order.items || order.items.length === 0) {
          return order;
        }

        // Fetch complete item details for each item in the order
        const completeItems = await Promise.all(
          order.items.map(async (orderItem) => {
            try {
              // Get full item details from Item collection
              const fullItem = await Item.findById(orderItem.itemId)
                .populate("categoryId", "name")
                .lean();

              if (!fullItem) {
                // If item not found, return order item as is
                return orderItem;
              }

              // Get menu information
              let menuInfo = null;
              if (orderItem.menuId) {
                const menu = await Menu.findById(orderItem.menuId)
                  .select("name logo")
                  .lean();
                if (menu) {
                  menuInfo = {
                    menuId: menu._id,
                    menuName: menu.name,
                    menuLogo: menu.logo,
                  };
                }
              }

              // Combine order item data with complete item details
              return {
                // Core identification
                _id: fullItem._id,
                itemId: fullItem._id,

                // Names and display
                name: fullItem.name,
                originalName: fullItem.name,

                // Admin and category information
                adminId: fullItem.adminId,
                categoryId: fullItem.categoryId?._id || fullItem.categoryId,
                categoryName: fullItem.categoryId?.name || "General",

                // Menu information
                menuId: orderItem.menuId || null,
                menuName:
                  orderItem.menuName || menuInfo?.menuName || "General Items",
                menuLogo: menuInfo?.menuLogo || null,

                // Timestamps and versioning
                createdAt: fullItem.createdAt,
                updatedAt: fullItem.updatedAt,
                __v: fullItem.__v,

                // Pricing information
                originalPrice: fullItem.originalPrice || fullItem.price,
                price: orderItem.price || fullItem.price,
                basePrice: fullItem.price,
                totalPrice: fullItem.totalPrice || fullItem.price,

                // Discount information
                discount: fullItem.discount || 0,
                itemDiscount: orderItem.itemDiscount || fullItem.discount || 0,

                // Tax information
                tax: fullItem.tax || { cash: "0", card: "0" },
                itemTax: orderItem.itemTax || fullItem.tax?.cash || "0",
                cashTax: fullItem.tax?.cash || "0",
                cardTax: fullItem.tax?.card || "0",
                totalTax: orderItem.totalTax || 0,

                // Options information
                options: fullItem.options || [],
                selectedOptions:
                  orderItem.options || orderItem.selectedOptions || [],

                // Media and visual
                pictureURL: fullItem.pictureURL || "",

                // Order-specific data
                quantity: orderItem.quantity,
                paymentMethod: orderItem.paymentMethod,
                paymentType: orderItem.paymentType,

                // Additional calculated fields
                itemSubtotal:
                  (orderItem.price || fullItem.price) * orderItem.quantity,
                itemTotalAfterDiscount:
                  ((orderItem.price || fullItem.price) -
                    (fullItem.discount || 0)) *
                  orderItem.quantity,
                finalItemPrice:
                  (orderItem.price || fullItem.price) -
                  (fullItem.discount || 0),

                // Status and metadata
                status: "active",
                isNewlyAdded: false,
              };
            } catch (itemError) {
              console.error(
                `Error fetching item details for ${orderItem.itemId}:`,
                itemError
              );
              // Return original order item if fetch fails
              return {
                ...orderItem,
                _id: orderItem.itemId,
                adminId: adminId,
                categoryId: null,
                categoryName: "General",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                __v: 0,
                originalPrice: orderItem.price || 0,
                basePrice: orderItem.price || 0,
                totalPrice: orderItem.price || 0,
                discount: 0,
                itemDiscount: orderItem.itemDiscount || 0,
                tax: { cash: "0", card: "0" },
                cashTax: "0",
                cardTax: "0",
                options: [],
                selectedOptions: orderItem.options || [],
                pictureURL: "",
                itemSubtotal: (orderItem.price || 0) * orderItem.quantity,
                itemTotalAfterDiscount:
                  (orderItem.price || 0) * orderItem.quantity,
                finalItemPrice: orderItem.price || 0,
                status: "active",
                isNewlyAdded: false,
              };
            }
          })
        );

        return {
          ...order,
          items: completeItems,
        };
      })
    );

    // Transform data for Excel export using the EXACT SAME calculation logic as frontend SuperAdmin component
    const excelData = [];

    for (const order of ordersWithCompleteItems) {
      console.log(`Processing order with complete items`, order._id);

      // Use the EXACT same variable names and calculation steps as frontend
      let totalOriginalAmount = 0;
      let totalItemDiscount = 0;
      let totalTaxAmount = 0;
      let totalFinalAmount = 0;
      let totalOptionsPrice = 0;
      let totalBasePrice = 0;

      if (order.items && order.items.length > 0) {
        order.items.forEach((item) => {
          const basePrice =
            item.basePrice || item.originalPrice || item.price || 0;
          const options = item.options || [];
          const optionsPrice = options.reduce(
            (sum, opt) => sum + (opt.price || 0),
            0
          );
          const discount = item.discount || item.itemDiscount || 0;
          const quantity = item.quantity || 1;

          // Determine tax rate based on payment method
          const paymentMethod =
            order.paymentMethod || order.paymentType || "CASH";
          const taxRates = item.tax || { card: "0", cash: "0" };
          const taxRate =
            paymentMethod === "CARD"
              ? parseFloat(taxRates.card || "0")
              : parseFloat(taxRates.cash || "0");

          // Calculate original amount before discounts
          const originalAmount = basePrice + optionsPrice;

          // Calculate tax on original amount
          const taxAmount = (originalAmount * taxRate) / 100;

          // Final calculation: basePrice + options - discount + tax
          const finalPrice = originalAmount - discount + taxAmount;

          totalOriginalAmount += originalAmount * quantity;
          totalItemDiscount += discount * quantity;
          totalTaxAmount += taxAmount * quantity;
          totalFinalAmount += finalPrice * quantity;
          totalOptionsPrice += optionsPrice * quantity;
          totalBasePrice += basePrice * quantity;
        });
      }

      const voucherDiscount = order.voucherDiscount || 0;
      const finalOrderTotal = totalFinalAmount - voucherDiscount;

      // Format date and time
      const orderDateTime = order.createdAt
        ? new Date(order.createdAt)
        : new Date();
      const formattedDate = !isNaN(orderDateTime.getTime())
        ? `${orderDateTime.toLocaleDateString()} ${orderDateTime.toLocaleTimeString()}`
        : "N/A";

      // Create single row per order (no item breakdown)
      excelData.push({
        "Order ID": order._id
          ? String(order._id).slice(-8).toUpperCase()
          : "N/A",
        "Order Type": order.orderType || "DINE",
        Status: order.orderStatus || "COMPLETED",
        "Date & Time": formattedDate,
        Items: order.items?.length || 0,
        "Base Price": totalBasePrice.toFixed(2),
        "Options Price": totalOptionsPrice.toFixed(2),
        Tax: totalTaxAmount.toFixed(2),
        "Voucher Discount": voucherDiscount.toFixed(2),
        Discount: totalItemDiscount.toFixed(2),
        Total: finalOrderTotal.toFixed(2),
        "Payment Method": order.paymentMethod || order.paymentType || "CASH",
      });
    }

    console.log(
      `Exported ${ordersWithCompleteItems.length} orders with ${excelData.length} item records`
    );

    res.status(200).json({
      success: true,
      data: excelData,
      message: `Exported ${ordersWithCompleteItems.length} orders with ${excelData.length} item records`,
    });
  } catch (error) {
    console.error("Error exporting orders to Excel:", error);
    res.status(500).json({
      success: false,
      message: "Failed to export orders",
      error: error.message,
    });
  }
};

const updatePaymentMethod = async (req, res) => {
  try {
    const { orderId } = req.body; // orderId from URL
    const { paymentMethod } = req.body; // CASH, CARD, ONLINE

    // Validate payment method
    const allowedMethods = ["CASH", "CARD", "ONLINE"];
    if (!allowedMethods.includes(paymentMethod)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid payment method" });
    }

    const order = await Order.findByIdAndUpdate(
      orderId,
      { paymentMethod: paymentMethod },
      { new: true }
    );

    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    return res
      .status(200)
      .json({ success: true, message: "Payment method updated", order });
  } catch (error) {
    console.error("Error updating payment method:", error);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
};

module.exports = {
  createOrder,
  updateOrder,
  completeOrder,
  getPayment,
  getAllOrders,
  getOrdersForAdmin,
  exportOrdersToExcel,
  generateCustomerReceipts,
  printDailySalesReportAndCloseDay,
  updatePaymentMethod,
  addItemsAndDealsToOrder,
  deleteOrder,
};
