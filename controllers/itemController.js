const Item = require("../models/itemModel");
const Category = require("../models/categoryModel");
const Menu = require("../models/menuModel");
const { uploadToCloudinary } = require('../utils/cloudinary');


const createItem = async (req, res, next) => {
  try {
    const { name, price, categoryId, options, adminId, tax, discount } = req.body;

    if (!req.file) {
      return res.status(400).json({ success: false, message: "Picture is required" });
    }

    // Upload image to Cloudinary
    const cloudResult = await uploadToCloudinary(req.file.path);
    const pictureURL = cloudResult.secure_url;

    // Parse options if needed
    let parsedOptions = [];
    if (options) {
      try {
        parsedOptions = typeof options === 'string' ? JSON.parse(options) : options;
      } catch (parseError) {
        return res.status(400).json({ success: false, message: "Invalid options format" });
      }
    }

    // Parse tax if needed
    let parsedTax = tax;
    if (tax && typeof tax === 'string') {
      try {
        parsedTax = JSON.parse(tax);
      } catch (parseError) {
        return res.status(400).json({ success: false, message: "Invalid tax format" });
      }
    }

    // Validate category
    const categoryExists = await Category.findById(categoryId);
    if (!categoryExists) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    // Create item
    const newItem = await Item.create({
      name,
      price,
      pictureURL,
      categoryId,
      options: parsedOptions,
      adminId,
      tax: parsedTax,
      discount,
    });

    res.status(201).json({ success: true, data: newItem });
  } catch (error) {
    next(error);
  }
};


const getAllItemsOfAdmin = async (req, res, next) => {
  try {
    const adminId = req.params.adminId;

    const items = await Item.find({adminId});

    if (!items || items.length === 0) {
      return res.status(404).json({ success: false, message: 'No items found for this admin' });
    }

    res.status(200).json({ success: true, data: items });
  } catch (error) {
    next(error);
  }
};

const deleteItemOfAdmin = async (req, res, next) => {
  try {
    const adminId = req.params.adminId;
    const itemId = req.body.itemId;
    
    const item = await Item.findOneAndDelete({_id: itemId, adminId});

    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    res.status(200).json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
};

const updateItemOfAdmin = async (req, res, next) => {
  try {
    const adminId = req.params.adminId;
    const { itemId, name, price, categoryId, tax, options, discount, status, description } = req.body;

    const existingItem = await Item.findById(itemId);
    if (!existingItem) {
      return res.status(404).json({ success: false, message: "Item not found" });
    }

    // ✅ Update picture if file provided
    if (req.file?.path) {
      const cloudResult = await uploadToCloudinary(req.file.path);
      existingItem.pictureURL = cloudResult.secure_url;
    }

    // ✅ Update fields directly (replace old values)
    if (name !== undefined) existingItem.name = name;
    if (price !== undefined) existingItem.price = price;
    if (categoryId !== undefined) existingItem.categoryId = categoryId;
    if (discount !== undefined) existingItem.discount = discount;
    if (status !== undefined) existingItem.status = status;
    if (description !== undefined) existingItem.description = description;

    // ✅ Replace options (not merge) if provided
    if (options !== undefined) {
      const parsedOptions = typeof options === "string" ? JSON.parse(options) : options;
      existingItem.options = parsedOptions;
    }

    // ✅ Replace tax object if provided
    if (tax !== undefined) {
      const parsedTax = typeof tax === "string" ? JSON.parse(tax) : tax;
      existingItem.tax = parsedTax;
    }

    await existingItem.save();

    res.status(200).json({ success: true, data: existingItem });
  } catch (error) {
    console.error(error);
    next(error);
  }
};



// get all items for admin panel for a specific category
const getAllItemsForAdminPanel = async (req, res, next) => {
  try { 
    const adminId = req.user.id;
    const categoryId = req.params.categoryId;

    const items = await Item.find({ adminId, categoryId }).populate("categoryId");

    if (!items || items.length === 0) {
      return res.status(404).json({ success: false, message: 'No items found for this category' });
    }

    res.status(200).json({ success: true, data: items });
  }catch (error) {
    next(error);
  }
}

const getAllItemsForAdmin = async (req, res, next) => {
  try { 
    const adminId = req.user.id;

    // Get all items with category information
    const items = await Item.find({ adminId }).populate("categoryId");

    // Get all menus for this admin to find which menu each item belongs to
    const menus = await Menu.find({ adminId }).lean();

    // Enhance items with menu information
    const itemsWithMenuInfo = items.map(item => {
      const itemMenu = menus.find(menu => 
        menu.itemsID.some(itemId => itemId.toString() === item._id.toString())
      );

      return {
        ...item.toObject(),
        menuId: itemMenu ? itemMenu._id : null,
        menuName: itemMenu ? itemMenu.name : 'General Items',
        categoryName: item.categoryId ? item.categoryId.name : 'General'
      };
    });

    res.status(200).json({ success: true, data: itemsWithMenuInfo });
  }catch (error) {
    next(error);
  }
}

const importItems = async (req, res, next) => {
  try {
    const { sourceAdminId, targetAdminId } = req.body;

    if (!sourceAdminId || !targetAdminId) {
      return res.status(400).json({ success: false, message: "sourceAdminId and targetAdminId are required." });
    }

    const sourceItems = await Item.find({ adminId: sourceAdminId });

    if (sourceItems.length === 0) {
      return res.status(404).json({ success: false, message: "No items found for source admin." });
    }

    const newItems = sourceItems.map(item => ({
      name: item.name,
      price: item.price,
      pictureURL: item.pictureURL,
      categoryId: item.categoryId, // we will update this later
      options: item.options,
      tax: item.tax,
      discount: item.discount,
      adminId: targetAdminId,
    }));

    const createdItems = await Item.insertMany(newItems);

    res.status(200).json({
      success: true,
      message: "Items imported successfully. Now assign categories.",
      data: createdItems
    });
  } catch (error) {
    next(error);
  }
};


const assignCategoriesToImportedItems = async (req, res, next) => {
  try {
    const { assignments } = req.body;

    // Example: [{ itemId: "...", categoryId: "..." }, {...}]
    if (!Array.isArray(assignments) || assignments.length === 0) {
      return res.status(400).json({ success: false, message: "Assignments array is required." });
    }

    const updatePromises = assignments.map(assign =>
      Item.findByIdAndUpdate(assign.itemId, { categoryId: assign.categoryId }, { new: true })
    );

    const updatedItems = await Promise.all(updatePromises);

    res.status(200).json({
      success: true,
      message: "Categories assigned to imported items successfully.",
      data: updatedItems,
    });
  } catch (error) {
    next(error);
  }
};





module.exports = { createItem, getAllItemsOfAdmin, deleteItemOfAdmin, updateItemOfAdmin, getAllItemsForAdminPanel, getAllItemsForAdmin, importItems, assignCategoriesToImportedItems };
