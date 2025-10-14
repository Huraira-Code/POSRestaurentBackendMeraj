const Deal = require("../models/dealModel");
const Item = require("../models/itemModel");
const User = require("../models/userModel");

const createDeal = async (req, res, next) => {
  try {
    const superAdminId = req.user.id;
    const {
      name,
      description,
      items,
      dealPrice,
      adminId,
      validUntil,
      customizations,
    } = req.body;

    // ✅ 1. Ensure unique deal name for this admin
    const existingDeal = await Deal.findOne({
      adminId,
      name: { $regex: new RegExp(`^${name.trim()}$`, "i") },
    });
    if (existingDeal) {
      return res.status(400).json({
        success: false,
        message:
          "Deal name must be unique for this admin. A deal with this name already exists.",
      });
    }

    // ✅ 2. Validate that all items exist & belong to the admin
    for (const dealItem of items) {
      const item = await Item.findById(dealItem.itemId);
      if (!item) {
        return res.status(404).json({
          success: false,
          message: `Item with ID ${dealItem.itemId} not found`,
        });
      }
      if (item.adminId.toString() !== adminId) {
        return res.status(400).json({
          success: false,
          message: `Item '${item.name}' does not belong to this admin`,
        });
      }
    }

    // ✅ 3. Verify admin exists
    const admin = await User.findById(adminId);
    if (!admin || admin.role !== "Admin") {
      return res.status(404).json({
        success: false,
        message: "Admin not found or invalid role",
      });
    }

    // ✅ 4. Recursive customization validator
    const validateOptions = (options, parentName) => {
      if (!Array.isArray(options) || options.length === 0) {
        throw new Error(
          `Customization '${parentName}' must have at least one option`
        );
      }

      for (const option of options) {
        if (!option.name || typeof option.name !== "string") {
          throw new Error(
            `Invalid option in customization '${parentName}' – option must have a name`
          );
        }
        if (option.subOptions && option.subOptions.length > 0) {
          validateOptions(option.subOptions, option.name); // 🔁 recursion
        }
      }
    };

    if (customizations && Array.isArray(customizations)) {
      for (const customization of customizations) {
        if (!customization.name || typeof customization.name !== "string") {
          return res.status(400).json({
            success: false,
            message: "Each customization must have a valid name",
          });
        }
        if (customization.minSelect > customization.maxSelect) {
          return res.status(400).json({
            success: false,
            message: `Customization '${customization.name}' has invalid min/max selection`,
          });
        }

        try {
          validateOptions(customization.options, customization.name);
        } catch (err) {
          return res.status(400).json({ success: false, message: err.message });
        }
      }
    }

    // ✅ 5. Create new deal
    const newDeal = await Deal.create({
      name: name.trim(),
      description,
      items,
      dealPrice,
      adminId,
      validUntil,
      createdBy: superAdminId,
      customizations,
    });

    // ✅ 6. Populate items for response
    await newDeal.getDetailsWithItems();

    res.status(201).json({
      success: true,
      message: "Deal created successfully",
      data: newDeal,
    });
  } catch (error) {
    next(error);
  }
};

// Get all deals for a specific admin (SuperAdmin view)
const getDealsForAdmin = async (req, res, next) => {
  try {
    const { adminId } = req.params;

    const deals = await Deal.find({ adminId })
      .populate({
        path: "items.itemId",
        select: "name price pictureURL categoryId",
      })
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: deals,
    });
  } catch (error) {
    next(error);
  }
};

// Get all deals for current admin (Admin view)
const getMyDeals = async (req, res, next) => {
  try {
    const adminId = req.user.id;

    const deals = await Deal.find({
      adminId,
      isActive: true,
      $or: [
        { validUntil: { $exists: false } },
        { validUntil: null },
        { validUntil: { $gte: new Date() } },
      ],
    })
      .populate({
        path: "items.itemId",
        select: "name price pictureURL categoryId tax",
      })
      .sort({ createdAt: -1 });

    // Process deals to ensure selectedOptions field is always present
    const processedDeals = deals.map((deal) => {
      const dealData = deal.toObject();
      dealData.items = dealData.items.map((item) => ({
        ...item,
        selectedOptions: item.selectedOptions || [],
      }));
      return dealData;
    });

    res.status(200).json({
      success: true,
      data: processedDeals,
    });
  } catch (error) {
    next(error);
  }
};

// Update a deal (SuperAdmin only)
const updateDeal = async (req, res, next) => {
  try {
    const { dealId } = req.params;
    const {
      name,
      description,
      items,
      customizations,
      dealPrice,
      isActive,
      validUntil,
    } = req.body;

    const deal = await Deal.findById(dealId);
    if (!deal) {
      return res.status(404).json({
        success: false,
        message: "Deal not found",
      });
    }

    // Check if deal name already exists for this admin (excluding current deal)
    if (name && name.trim() !== deal.name) {
      const existingDeal = await Deal.findOne({
        _id: { $ne: dealId },
        adminId: deal.adminId,
        name: { $regex: new RegExp(`^${name.trim()}$`, "i") },
      });
      if (existingDeal) {
        return res.status(400).json({
          success: false,
          message:
            "Deal name must be unique for this admin. A deal with this name already exists for this restaurant.",
        });
      }
    }

    // If items are being updated, validate them
    if (items) {
      for (const dealItem of items) {
        const item = await Item.findById(dealItem.itemId);
        if (!item) {
          return res.status(404).json({
            success: false,
            message: `Item with ID ${dealItem.itemId} not found`,
          });
        }
        if (item.adminId.toString() !== deal.adminId.toString()) {
          return res.status(400).json({
            success: false,
            message: `Item ${item.name} does not belong to this admin`,
          });
        }
      }
    }

    const updatedDeal = await Deal.findByIdAndUpdate(
      dealId,
      {
        ...(name && { name: name.trim() }),
        ...(description !== undefined && { description }),
        ...(items && { items }),
        ...(customizations && { customizations }),
        ...(dealPrice && { dealPrice }),
        ...(isActive !== undefined && { isActive }),
        ...(validUntil !== undefined && { validUntil }),
      },
      { new: true, runValidators: true }
    );

    await updatedDeal.getDetailsWithItems();

    res.status(200).json({
      success: true,
      message: "Deal updated successfully",
      data: updatedDeal,
    });
  } catch (error) {
    next(error);
  }
};

// Delete a deal (SuperAdmin only)
const deleteDeal = async (req, res, next) => {
  try {
    const { dealId } = req.params;

    const deal = await Deal.findById(dealId);
    if (!deal) {
      return res.status(404).json({
        success: false,
        message: "Deal not found",
      });
    }

    await Deal.findByIdAndDelete(dealId);

    res.status(200).json({
      success: true,
      message: "Deal deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// Get deal by ID with full details
const getDealById = async (req, res, next) => {
  try {
    const { dealId } = req.params;

    const deal = await Deal.findById(dealId)
      .populate({
        path: "items.itemId",
        select: "name price pictureURL categoryId tax",
      })
      .populate("createdBy", "name email");

    if (!deal) {
      return res.status(404).json({
        success: false,
        message: "Deal not found",
      });
    }

    res.status(200).json({
      success: true,
      data: deal,
    });
  } catch (error) {
    next(error);
  }
};

// Get all deals created by current SuperAdmin
const getMyCreatedDeals = async (req, res, next) => {
  try {
    const superAdminId = req.user.id;

    const deals = await Deal.find({ createdBy: superAdminId })
      .populate({
        path: "items.itemId",
        select: "name price pictureURL categoryId",
      })
      .populate("adminId", "name email")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: deals,
    });
  } catch (error) {
    next(error);
  }
};

// Calculate deal tax for a specific payment method
const calculateDealTax = async (req, res, next) => {
  try {
    const { dealId } = req.params;
    const { paymentMethod = "CASH" } = req.query;

    const deal = await Deal.findById(dealId);
    if (!deal) {
      return res.status(404).json({
        success: false,
        message: "Deal not found",
      });
    }

    const tax = await deal.calculateTax(paymentMethod);

    res.status(200).json({
      success: true,
      data: {
        dealId,
        dealPrice: deal.dealPrice,
        tax,
        totalWithTax: deal.dealPrice + tax,
        paymentMethod,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createDeal,
  getDealsForAdmin,
  getMyDeals,
  updateDeal,
  deleteDeal,
  getDealById,
  getMyCreatedDeals,
  calculateDealTax,
};
