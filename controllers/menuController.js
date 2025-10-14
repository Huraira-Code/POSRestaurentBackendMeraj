const Menu = require("../models/menuModel");
const Item = require("../models/itemModel");
const User = require("../models/userModel");
const { uploadToCloudinary } = require("../utils/cloudinary");


const createMenu = async (req, res) => {
  try {
    console.log("Create menu request body:", req.body);
    console.log("Create menu request file:", req.file);
    
    const { name, adminId, itemsID } = req.body;

    // Parse itemsID if it's a string (from FormData)
    let parsedItemsID = [];
    if (itemsID) {
      try {
        parsedItemsID = typeof itemsID === 'string' ? JSON.parse(itemsID) : itemsID;
      } catch (parseError) {
        return res.status(400).json({ success: false, message: "Invalid items format" });
      }
    }

    // Check Admin Exists
    const admin = await User.findById(adminId);
    if (!admin) {
      return res.status(400).json({
        success: false,
        message: "Admin Does Not Exist",
      });
    }

    // Check if all item IDs are valid
    const foundItems = await Item.find({ _id: { $in: parsedItemsID } });
    if (foundItems.length !== parsedItemsID.length) {
      return res.status(400).json({
        success: false,
        message: "One or more item IDs are invalid.",
      });
    }

    // Upload logo to Cloudinary if provided
    let logoUrl = '';
    if (req.file) {
      try {
        const cloudinaryResult = await uploadToCloudinary(req.file.path);
        logoUrl = cloudinaryResult.secure_url;
      } catch (uploadError) {
        console.error("Cloudinary upload error:", uploadError);
        return res.status(500).json({
          success: false,
          message: "Failed to upload logo image",
        });
      }
    }

    const menu = await Menu.create({
      logo: logoUrl,
      name,
      adminId,
      itemsID: parsedItemsID,
    });

    res.status(201).json({
      success: true,
      message: "Menu created successfully",
      data: menu,
    });
  } catch (error) {
    console.error("Error creating menu:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};



// Get menu assigned to a specific admin
const getAllMenuOfAdmin = async (req, res, next) => {
  try {
    const adminId = req.params.adminId || req.user.id;

    const menus = await Menu.find({ adminId }).populate("itemsID");;

    if (!menus || menus.length === 0) {
      return res.status(404).json({ success: false, message: 'No menus found for this admin' });
    }

    res.status(200).json({ success: true, data: menus });
  } catch (error) {
    next(error);
  }
};

// Delete menu assigned to a specific admin
const deleteMenuOfAdmin = async (req, res, next) => {
  try {
    const adminId = req.params.adminId;
    const menuId = req.body.menuId;

    const menu = await Menu.findOneAndDelete({ _id: menuId, adminId });
    
    if (!menu) {
      return res.status(404).json({ success: false, message: 'Menu not found' });
    }

    res.status(200).json({ success: true, data: menu });
  } catch (error) {
    next(error);
  }
};

// Update menu assigned to a specific admin
const updateMenuOfAdmin = async (req, res, next) => {
  try {
    const adminId = req.params.adminId;
    const { menuId, name, description } = req.body;
    
    // Parse itemsID if it's a string (from FormData)
    let parsedItemsID = [];
    if (req.body.itemsID) {
      try {
        parsedItemsID = typeof req.body.itemsID === 'string' ? JSON.parse(req.body.itemsID) : req.body.itemsID;
      } catch (parseError) {
        return res.status(400).json({ success: false, message: "Invalid items format" });
      }
    }

    // Find existing menu
    const menu = await Menu.findOne({ _id: menuId, adminId });

    if (!menu) {
      return res.status(404).json({ success: false, message: 'Menu not found' });
    }

    // Upload new logo to Cloudinary if provided
    let logoUrl = menu.logo; // Keep existing logo by default
    if (req.file) {
      try {
        const cloudinaryResult = await uploadToCloudinary(req.file.path);
        logoUrl = cloudinaryResult.secure_url;
      } catch (uploadError) {
        console.error("Cloudinary upload error:", uploadError);
        return res.status(500).json({
          success: false,
          message: "Failed to upload logo image",
        });
      }
    }

    // Update fields
    menu.name = name ?? menu.name;
    menu.description = description ?? menu.description;
    menu.logo = logoUrl;
    
    // Only update itemsID if provided
    if (parsedItemsID.length > 0) {
      menu.itemsID = parsedItemsID;
    }

    await menu.save();

    res.status(200).json({ success: true, data: menu });
  } catch (error) {
    next(error);
  }
};

const importMenus = async (req, res, next) => {
  try {
    const { sourceAdminId, targetAdminId } = req.body;

    if (!sourceAdminId || !targetAdminId) {
      return res.status(400).json({ success: false, message: "Both sourceAdminId and targetAdminId are required." });
    }

    // Step 1: Get menus from source admin
    const sourceMenus = await Menu.find({ adminId: sourceAdminId });

    if (!sourceMenus.length) {
      return res.status(404).json({ success: false, message: 'No menus found for the source admin.' });
    }

    // Step 2: Clone each menu for target admin
    const clonedMenus = await Promise.all(
      sourceMenus.map(menu => {
        const clonedMenu = new Menu({
          name: menu.name,
          logo: menu.logo,
          itemsID: [], // Initialize empty - items will be assigned later
          adminId: targetAdminId
        });
        return clonedMenu.save();
      })
    );

    res.status(201).json({
      success: true,
      message: `${clonedMenus.length} menu(s) imported successfully.`,
      data: clonedMenus
    });

  } catch (error) {
    next(error);
  }
};

const assignItemToImportedMenu = async (req, res, next) => {
  try {
    const { menuId, itemIds } = req.body;

    if (!menuId || !itemIds || !Array.isArray(itemIds)) {
      return res.status(400).json({ success: false, message: "menuId and itemIds array are required." });
    }

    // Optional: Validate if items exist
    const itemsExist = await Item.find({ _id: { $in: itemIds } });
    if (itemsExist.length !== itemIds.length) {
      return res.status(400).json({ success: false, message: 'One or more item IDs are invalid.' });
    }

    // Replace existing itemsID array with new itemIds
    const updatedMenu = await Menu.findByIdAndUpdate(
      menuId,
      { $set: { itemsID: itemIds } }, // <-- replace entire array
      { new: true }
    ).populate('itemsID');

    if (!updatedMenu) {
      return res.status(404).json({ success: false, message: 'Menu not found.' });
    }

    res.status(200).json({
      success: true,
      message: 'Items assigned to imported menu successfully.',
      data: updatedMenu
    });

  } catch (error) {
    next(error);
  }
};

const removeItemFromMenu = async (req, res, next) => {
  try {
    const { menuId, itemId } = req.body;

    // Validate input
    if (!menuId || !itemId) {
      return res.status(400).json({ success: false, message: "menuId and itemId are required" });
    }

    // Find and update menu by pulling the item
    const updatedMenu = await Menu.findByIdAndUpdate(
      menuId,
      { $pull: { itemsID: itemId } },
      { new: true }
    );

    if (!updatedMenu) {
      return res.status(404).json({ success: false, message: "Menu not found" });
    }

    res.status(200).json({ success: true, message: "Item removed from menu", data: updatedMenu });
  } catch (error) {
    next(error);
  }
};



module.exports = {
  createMenu,
  getAllMenuOfAdmin,
  deleteMenuOfAdmin,
  updateMenuOfAdmin,
  importMenus,
  assignItemToImportedMenu,
  removeItemFromMenu
};
