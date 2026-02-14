import Item from "../models/item.model.js";
import Shop from "../models/shop.model.js";
import Category from "../models/category.model.js";
import uploadOnCloudinary from "../utils/cloudinary.js";
import { clearExpiredClosures } from "../utils/shopClosure.js";
import mongoose from "mongoose";

export const addItem = async (req, res) => {
  try {
    const {
      name,
      nameThai,
      nameEnglish,
      category,
      categories,
      foodType,
      price,
      onlinePrice,
      inStorePrice,
      optionSections,
      selectedOptionTemplates,
      isRecommended,
      isAvailable,
      descriptionThai,
      descriptionEnglish,
    } = req.body;
    let image;
    if (req.file) {
      image = await uploadOnCloudinary(req.file.path);
    }
    const shop = await Shop.findOne({ owner: req.userId });
    if (!shop) {
      return res.status(400).json({ message: "shop not found" });
    }

    // Use nameThai or nameEnglish as primary name if name is not provided
    const primaryName = name || nameThai || nameEnglish || "";

    const itemData = {
      name: primaryName,
      nameThai: nameThai || "",
      nameEnglish: nameEnglish || "",
      category:
        category || (categories && categories.length > 0 ? categories[0] : ""),
      foodType,
      price: price || onlinePrice || inStorePrice || 0,
      image,
      shop: shop._id,
    };

    if (onlinePrice) itemData.onlinePrice = parseFloat(onlinePrice);
    if (inStorePrice) itemData.inStorePrice = parseFloat(inStorePrice);
    if (categories) {
      try {
        const categoryIds =
          typeof categories === "string" ? JSON.parse(categories) : categories;
        itemData.categories = categoryIds;
        // Set categoryRef to first category for backward compatibility
        if (categoryIds.length > 0) {
          itemData.categoryRef = categoryIds[0];
          // Set category string to first category's name
          const firstCategory = await Category.findById(categoryIds[0]);
          if (firstCategory) {
            itemData.category = firstCategory.name;
          }
        }
      } catch (e) {
        itemData.categories = [];
      }
    }
    if (selectedOptionTemplates) {
      try {
        itemData.selectedOptionTemplates =
          typeof selectedOptionTemplates === "string"
            ? JSON.parse(selectedOptionTemplates)
            : selectedOptionTemplates;
      } catch (e) {
        itemData.selectedOptionTemplates = [];
      }
    }
    if (isRecommended !== undefined)
      itemData.isRecommended =
        isRecommended === true || isRecommended === "true";
    if (isAvailable !== undefined)
      itemData.isAvailable = isAvailable !== false && isAvailable !== "false";
    if (descriptionThai) itemData.descriptionThai = descriptionThai;
    if (descriptionEnglish) itemData.descriptionEnglish = descriptionEnglish;

    if (optionSections) {
      try {
        itemData.optionSections = JSON.parse(optionSections);
      } catch (e) {
        // If parsing fails, use as-is (might already be an object)
        itemData.optionSections = optionSections;
      }
    }

    const item = await Item.create(itemData);

    shop.items.push(item._id);
    await shop.save();
    await shop.populate("owner");
    await shop.populate({
      path: "items",
      options: { sort: { updatedAt: -1 } },
    });
    return res.status(201).json(shop);
  } catch (error) {
    return res.status(500).json({ message: `add item error ${error}` });
  }
};

export const editItem = async (req, res) => {
  try {
    const itemId = req.params.itemId;
    const {
      name,
      nameThai,
      nameEnglish,
      category,
      categories,
      foodType,
      price,
      onlinePrice,
      inStorePrice,
      optionSections,
      selectedOptionTemplates,
      isRecommended,
      isAvailable,
      descriptionThai,
      descriptionEnglish,
    } = req.body;
    let image;
    if (req.file) {
      image = await uploadOnCloudinary(req.file.path);
    }

    const primaryName = name || nameThai || nameEnglish || "";

    const updateData = {
      name: primaryName,
      category:
        category || (categories && categories.length > 0 ? categories[0] : ""),
      foodType,
      price: price || onlinePrice || inStorePrice || 0,
    };

    if (nameThai !== undefined) updateData.nameThai = nameThai;
    if (nameEnglish !== undefined) updateData.nameEnglish = nameEnglish;
    if (onlinePrice !== undefined)
      updateData.onlinePrice = onlinePrice ? parseFloat(onlinePrice) : null;
    if (inStorePrice !== undefined)
      updateData.inStorePrice = inStorePrice ? parseFloat(inStorePrice) : null;
    if (categories !== undefined) {
      try {
        const categoryIds =
          typeof categories === "string" ? JSON.parse(categories) : categories;
        updateData.categories = categoryIds;
        // Set categoryRef to first category for backward compatibility
        if (categoryIds.length > 0) {
          updateData.categoryRef = categoryIds[0];
          // Set category string to first category's name
          const firstCategory = await Category.findById(categoryIds[0]);
          if (firstCategory) {
            updateData.category = firstCategory.name;
          }
        }
      } catch (e) {
        updateData.categories = [];
      }
    }
    if (selectedOptionTemplates !== undefined) {
      try {
        updateData.selectedOptionTemplates =
          typeof selectedOptionTemplates === "string"
            ? JSON.parse(selectedOptionTemplates)
            : selectedOptionTemplates;
      } catch (e) {
        updateData.selectedOptionTemplates = [];
      }
    }
    if (isRecommended !== undefined)
      updateData.isRecommended =
        isRecommended === true || isRecommended === "true";
    if (isAvailable !== undefined)
      updateData.isAvailable = isAvailable !== false && isAvailable !== "false";
    if (descriptionThai !== undefined)
      updateData.descriptionThai = descriptionThai;
    if (descriptionEnglish !== undefined)
      updateData.descriptionEnglish = descriptionEnglish;

    if (image) {
      updateData.image = image;
    }

    if (optionSections !== undefined) {
      try {
        updateData.optionSections =
          typeof optionSections === "string"
            ? JSON.parse(optionSections)
            : optionSections;
      } catch (e) {
        updateData.optionSections = optionSections;
      }
    }

    const item = await Item.findByIdAndUpdate(itemId, updateData, {
      new: true,
    });
    if (!item) {
      return res.status(400).json({ message: "item not found" });
    }
    const shop = await Shop.findOne({ owner: req.userId }).populate({
      path: "items",
      options: { sort: { updatedAt: -1 } },
    });
    return res.status(200).json(shop);
  } catch (error) {
    return res.status(500).json({ message: `edit item error ${error}` });
  }
};

export const getItemById = async (req, res) => {
  try {
    const itemId = req.params.itemId;
    if (!itemId || !mongoose.isValidObjectId(itemId)) {
      return res.status(400).json({ message: "invalid item id" });
    }
    const item = await Item.findById(itemId).populate({
      path: "selectedOptionTemplates",
    });
    if (!item) {
      return res.status(400).json({ message: "item not found" });
    }
    return res.status(200).json(item);
  } catch (error) {
    return res.status(500).json({ message: `get item error ${error}` });
  }
};

export const deleteItem = async (req, res) => {
  try {
    const itemId = req.params.itemId;
    const item = await Item.findByIdAndDelete(itemId);
    if (!item) {
      return res.status(400).json({ message: "item not found" });
    }
    const shop = await Shop.findOne({ owner: req.userId });
    shop.items = shop.items.filter((i) => !i.equals(item._id));
    await shop.save();
    await shop.populate({
      path: "items",
      options: { sort: { updatedAt: -1 } },
    });
    return res.status(200).json(shop);
  } catch (error) {
    return res.status(500).json({ message: `delete item error ${error}` });
  }
};

export const getItemByCity = async (req, res) => {
  try {
    const { city } = req.params;
    if (!city) {
      return res.status(400).json({ message: "city is required" });
    }

    const shops = await Shop.find({ cafeteria: city }).populate("items");
    if (!shops) {
      return res.status(400).json({ message: "shops not found" });
    }
    const shopIds = shops.map((shop) => shop._id);
    const items = await Item.find({
      shop: { $in: shopIds },
      isAvailable: { $ne: false },
    });
    return res.status(200).json(items);
  } catch (error) {
    return res.status(500).json({ message: `get item by city error ${error}` });
  }
};

export const getItemsByShop = async (req, res) => {
  try {
    const { shopId } = req.params;
    const shop = await Shop.findById(shopId).populate("category");
    if (!shop) {
      return res.status(400).json("shop not found");
    }
    // Clear expired closures before returning
    await clearExpiredClosures(shop);
    // Get only available items
    const items = await Item.find({
      shop: shopId,
      isAvailable: { $ne: false },
    }).populate([
      {
        path: "selectedOptionTemplates",
      },
      {
        path: "categories",
      },
      {
        path: "categoryRef",
      },
    ]);
    return res.status(200).json({
      shop,
      items,
    });
  } catch (error) {
    return res.status(500).json({ message: `get item by shop error ${error}` });
  }
};

export const searchItems = async (req, res) => {
  try {
    const { query, city } = req.query;
    if (!query || !city) {
      return null;
    }

    const shops = await Shop.find({ cafeteria: city }).populate("items");
    if (!shops) {
      return res.status(400).json({ message: "shops not found" });
    }
    const shopIds = shops.map((s) => s._id);
    const items = await Item.find({
      shop: { $in: shopIds },
      isAvailable: { $ne: false },
      $or: [
        { name: { $regex: query, $options: "i" } },
        { category: { $regex: query, $options: "i" } },
      ],
    }).populate("shop", "name image");
    return res.status(200).json(items);
  } catch (error) {
    return res.status(500).json({ message: `search item error ${error}` });
  }
};

export const rating = async (req, res) => {
  try {
    const { itemId, rating } = req.body;
    if (!itemId || !rating) {
      return res
        .status(400)
        .json({ message: "itemId and rating are required" });
    }
    if (rating < 1 || rating > 5) {
      return res
        .status(400)
        .json({ message: "rating must be between 1 and 5" });
    }
    const item = await Item.findById(itemId);
    if (!item) {
      return res.status(400).json({ message: "item not found" });
    }
    const newCount = item.rating.count + 1;
    const newAverage =
      (item.rating.average * item.rating.count + rating) / newCount;

    item.rating.average = newAverage;
    item.rating.count = newCount;
    await item.save();
    return res.status(200).json({ rating: item.rating });
  } catch (error) {
    return res.status(500).json({ message: `search item error ${error}` });
  }
};

// Get items grouped by category for menu management
export const getItemsByCategory = async (req, res) => {
  try {
    const shop = await Shop.findOne({ owner: req.userId });
    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    // Auto-reopen items marked as outOfStockToday on the next day
    await autoReopenOutOfStockItems();

    const items = await Item.find({ shop: shop._id })
      .populate("categories")
      .populate("categoryRef")
      .sort({ createdAt: -1 });

    // Group items by category
    const itemsByCategory = {};

    items.forEach((item) => {
      // First, try to use categories array (new system)
      if (item.categories && item.categories.length > 0) {
        item.categories.forEach((cat) => {
          if (cat && cat.name) {
            const categoryName = cat.name;
            if (!itemsByCategory[categoryName]) {
              itemsByCategory[categoryName] = [];
            }
            // Only add item once per category (avoid duplicates if item is in multiple categories)
            if (
              !itemsByCategory[categoryName].find(
                (i) => i._id.toString() === item._id.toString(),
              )
            ) {
              itemsByCategory[categoryName].push(item);
            }
          }
        });
      }
      // Fallback to categoryRef (single category reference)
      else if (item.categoryRef && item.categoryRef.name) {
        const categoryName = item.categoryRef.name;
        if (!itemsByCategory[categoryName]) {
          itemsByCategory[categoryName] = [];
        }
        if (
          !itemsByCategory[categoryName].find(
            (i) => i._id.toString() === item._id.toString(),
          )
        ) {
          itemsByCategory[categoryName].push(item);
        }
      }
      // Fallback to category string field (backward compatibility)
      else if (item.category) {
        const categoryName = item.category;
        if (!itemsByCategory[categoryName]) {
          itemsByCategory[categoryName] = [];
        }
        if (
          !itemsByCategory[categoryName].find(
            (i) => i._id.toString() === item._id.toString(),
          )
        ) {
          itemsByCategory[categoryName].push(item);
        }
      }
    });

    return res.status(200).json({
      items,
      itemsByCategory,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Error fetching items: ${error.message}` });
  }
};

// Toggle item availability
export const toggleItemAvailability = async (req, res) => {
  try {
    const { itemId } = req.params;
    const { isAvailable, unavailabilityReason } = req.body;

    const shop = await Shop.findOne({ owner: req.userId });
    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    const item = await Item.findOne({ _id: itemId, shop: shop._id });
    if (!item) {
      return res.status(404).json({ message: "Item not found" });
    }

    if (isAvailable === false) {
      // Setting item as unavailable
      item.isAvailable = false;
      item.unavailabilityReason = unavailabilityReason || null;
      if (unavailabilityReason === "outOfStockToday") {
        // Set the date when marked as out of stock
        item.outOfStockDate = new Date();
      } else {
        item.outOfStockDate = null;
      }
    } else {
      // Setting item as available
      item.isAvailable = true;
      item.unavailabilityReason = null;
      item.outOfStockDate = null;
    }

    await item.save();

    return res.status(200).json(item);
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Error toggling item availability: ${error.message}` });
  }
};

// Auto-reopen items marked as outOfStockToday on the next day
export const autoReopenOutOfStockItems = async () => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Find items that were marked as out of stock today but it's now the next day
    const items = await Item.find({
      isAvailable: false,
      unavailabilityReason: "outOfStockToday",
      outOfStockDate: { $exists: true, $ne: null },
    });

    for (const item of items) {
      if (item.outOfStockDate) {
        const outOfStockDay = new Date(item.outOfStockDate);
        outOfStockDay.setHours(0, 0, 0, 0);

        // If the out of stock date is before today, reopen the item
        if (outOfStockDay < today) {
          item.isAvailable = true;
          item.unavailabilityReason = null;
          item.outOfStockDate = null;
          await item.save();
        }
      }
    }
  } catch (error) {
    console.error("Error auto-reopening out of stock items:", error);
  }
};
