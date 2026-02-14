import GlobalCategory from "../models/globalCategory.model.js";

export const getPublicGlobalCategories = async (req, res) => {
  try {
    const categories = await GlobalCategory.find({ isActive: true })
      .sort({ order: 1, createdAt: 1 })
      .lean();
    return res.status(200).json(categories);
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Get global categories error: ${error.message}` });
  }
};

export const adminGetGlobalCategories = async (req, res) => {
  try {
    const categories = await GlobalCategory.find({})
      .sort({ order: 1, createdAt: 1 })
      .lean();
    return res.status(200).json(categories);
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Get global categories error: ${error.message}` });
  }
};

export const adminCreateGlobalCategory = async (req, res) => {
  try {
    const { name, image, order, isActive } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: "Category name is required" });
    }

    const category = await GlobalCategory.create({
      name: String(name).trim(),
      image: typeof image === "string" ? image : "",
      order: typeof order === "number" ? order : 0,
      isActive: typeof isActive === "boolean" ? isActive : true,
    });

    return res.status(201).json(category);
  } catch (error) {
    const isDuplicate =
      error?.code === 11000 ||
      String(error?.message || "").toLowerCase().includes("duplicate");
    if (isDuplicate) {
      return res
        .status(400)
        .json({ message: "Category with this name already exists" });
    }

    return res
      .status(500)
      .json({ message: `Create global category error: ${error.message}` });
  }
};

export const adminUpdateGlobalCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { name, image, order, isActive } = req.body;

    const category = await GlobalCategory.findById(categoryId);
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    if (name !== undefined) category.name = String(name).trim();
    if (image !== undefined) category.image = typeof image === "string" ? image : "";
    if (order !== undefined) category.order = order;
    if (isActive !== undefined) category.isActive = isActive;

    await category.save();
    return res.status(200).json(category);
  } catch (error) {
    const isDuplicate =
      error?.code === 11000 ||
      String(error?.message || "").toLowerCase().includes("duplicate");
    if (isDuplicate) {
      return res
        .status(400)
        .json({ message: "Category with this name already exists" });
    }

    return res
      .status(500)
      .json({ message: `Update global category error: ${error.message}` });
  }
};

export const adminDeleteGlobalCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;

    const category = await GlobalCategory.findById(categoryId);
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    await GlobalCategory.deleteOne({ _id: categoryId });
    return res.status(200).json({ message: "Category deleted successfully" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Delete global category error: ${error.message}` });
  }
};
