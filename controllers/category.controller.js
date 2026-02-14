import Category from "../models/category.model.js";
import Shop from "../models/shop.model.js";
import Item from "../models/item.model.js";

// Get all categories for a shop
export const getCategories = async (req, res) => {
  try {
    const shop = await Shop.findOne({ owner: req.userId });
    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    const categories = await Category.find({ shop: shop._id })
      .sort({ order: 1, createdAt: 1 })
      .lean();

    return res.status(200).json(categories);
  } catch (error) {
    return res.status(500).json({ message: `Error fetching categories: ${error.message}` });
  }
};

// Create a new category
export const createCategory = async (req, res) => {
  try {
    const { name, order, icon } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Category name is required" });
    }

    const shop = await Shop.findOne({ owner: req.userId });
    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    // Check if category with same name already exists
    const existingCategory = await Category.findOne({
      shop: shop._id,
      name: name.trim(),
    });

    if (existingCategory) {
      return res.status(400).json({ message: "Category with this name already exists" });
    }

    const category = await Category.create({
      name: name.trim(),
      shop: shop._id,
      order: order || 0,
      icon: icon || null,
    });

    return res.status(201).json(category);
  } catch (error) {
    return res.status(500).json({ message: `Error creating category: ${error.message}` });
  }
};

// Update a category
export const updateCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { name, order, icon, isActive } = req.body;

    const shop = await Shop.findOne({ owner: req.userId });
    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    const category = await Category.findOne({
      _id: categoryId,
      shop: shop._id,
    });

    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    // If name is being changed, check for duplicates
    if (name && name.trim() !== category.name) {
      const existingCategory = await Category.findOne({
        shop: shop._id,
        name: name.trim(),
        _id: { $ne: categoryId },
      });

      if (existingCategory) {
        return res.status(400).json({ message: "Category with this name already exists" });
      }
    }

    if (name !== undefined) category.name = name.trim();
    if (order !== undefined) category.order = order;
    if (icon !== undefined) category.icon = icon;
    if (isActive !== undefined) category.isActive = isActive;

    await category.save();

    return res.status(200).json(category);
  } catch (error) {
    return res.status(500).json({ message: `Error updating category: ${error.message}` });
  }
};

// Delete a category
export const deleteCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;

    const shop = await Shop.findOne({ owner: req.userId });
    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    const category = await Category.findOne({
      _id: categoryId,
      shop: shop._id,
    });

    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    // Update items to remove category reference
    await Item.updateMany(
      { categoryRef: categoryId },
      { $unset: { categoryRef: "" } }
    );

    await Category.deleteOne({ _id: categoryId });

    return res.status(200).json({ message: "Category deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: `Error deleting category: ${error.message}` });
  }
};

// Reorder categories
export const reorderCategories = async (req, res) => {
  try {
    const { categoryOrders } = req.body; // Array of { categoryId, order }

    if (!Array.isArray(categoryOrders)) {
      return res.status(400).json({ message: "categoryOrders must be an array" });
    }

    const shop = await Shop.findOne({ owner: req.userId });
    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    // Update all categories in a single operation
    const updatePromises = categoryOrders.map(({ categoryId, order }) =>
      Category.updateOne(
        { _id: categoryId, shop: shop._id },
        { order }
      )
    );

    await Promise.all(updatePromises);

    const categories = await Category.find({ shop: shop._id })
      .sort({ order: 1, createdAt: 1 });

    return res.status(200).json(categories);
  } catch (error) {
    return res.status(500).json({ message: `Error reordering categories: ${error.message}` });
  }
};

