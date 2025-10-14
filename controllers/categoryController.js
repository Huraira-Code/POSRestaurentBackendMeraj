const Category = require('../models/categoryModel');
const User = require('../models/userModel');

// Create a new category (Only SuperAdmin)
const createCategory = async (req, res, next) => {
  try {
    const { name, adminId } = req.body;

    // Check Admin Exists
    const admin = await User.findById(adminId);
    
    if (!admin) { 
      return res.status(400).json({
        success: false,
        message: "Admin Does Not Exist",
      });
    }
    

    const categoryExists = await Category.findOne({ name: name.trim(), adminId });
    if (categoryExists) {
      return res.status(400).json({ success: false, message: 'Category already exists' });
    }

    const category = await Category.create({ name: name.trim(), adminId });

    res.status(201).json({ success: true, data: category });
  } catch (error) {
    next(error);
  }
};


// Get categories assigned to a specific admin
const getCategoriesForAdmin = async (req, res, next) => {
  try {
    const adminId = req.params.adminId || req.user.id; // decoded from access token by middleware

    const categories = await Category.find({adminId});

    if (!categories || categories.length === 0) {
      return res.status(404).json({ success: false, message: 'No categories found for this admin' });
    }

    res.status(200).json({ success: true, data: categories });
  } catch (error) {
    next(error);
  }
};

// Delete category assigned to a specific admin
const deleteCategory = async (req, res, next) => {
  try {
    const adminId = req.params.adminId;
    const categoryId = req.body.categoryId;

    const category = await Category.findOneAndDelete({ _id: categoryId, adminId,});
    
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    res.status(200).json({ success: true, data: category });
  } catch (error) {
    next(error);
  }
};

// Update category assigned to a specific admin
const updateCategory = async (req, res, next) => {
  try {
    const adminId = req.params.adminId;
     const { categoryId, name } = req.body;

    const category = await Category.findOneAndUpdate({ _id: categoryId, adminId,}, {name: name.trim()}, { new: true});

    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    res.status(200).json({ success: true, data: category });
  } catch (error) {
    next(error);
  }
};

const importCategories = async (req, res, next) => {
  try {
    const { sourceAdminId, targetAdminId } = req.body;

    if (!sourceAdminId || !targetAdminId) {
      return res.status(400).json({ success: false, message: "Both sourceAdminId and targetAdminId are required." });
    }

    // Step 1: Fetch all categories of source admin
    const sourceCategories = await Category.find({ adminId: sourceAdminId });

    if (sourceCategories.length === 0) {
      return res.status(404).json({ success: false, message: "No categories found for source admin." });
    }

    // Step 2: Create new categories for the target admin
    const newCategories = sourceCategories.map(cat => ({
      name: cat.name,
      adminId: targetAdminId,
    }));

    // Step 3: Insert new categories
    const createdCategories = await Category.insertMany(newCategories);

    res.status(200).json({
      success: true,
      message: "Categories imported successfully.",
      data: createdCategories,
    });
  } catch (error) {
    next(error);
  }
};


module.exports = { createCategory, getCategoriesForAdmin, deleteCategory, updateCategory,importCategories };  
