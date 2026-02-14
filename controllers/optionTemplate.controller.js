import OptionTemplate from "../models/optionTemplate.model.js";
import Shop from "../models/shop.model.js";

// Get all option templates for a shop
export const getOptionTemplates = async (req, res) => {
  try {
    const shop = await Shop.findOne({ owner: req.userId });
    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    const templates = await OptionTemplate.find({ shop: shop._id })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json(templates);
  } catch (error) {
    return res.status(500).json({ message: `Error fetching option templates: ${error.message}` });
  }
};

// Get a single option template by ID
export const getOptionTemplate = async (req, res) => {
  try {
    const { templateId } = req.params;

    // For owners: check shop ownership
    // For users: allow access to any template (needed for viewing items)
    const shop = await Shop.findOne({ owner: req.userId });
    
    let template;
    if (shop) {
      // Owner: only allow access to their own shop's templates
      template = await OptionTemplate.findOne({
        _id: templateId,
        shop: shop._id,
      });
    } else {
      // User: allow access to any template (for viewing items)
      template = await OptionTemplate.findById(templateId);
    }

    if (!template) {
      return res.status(404).json({ message: "Option template not found" });
    }

    return res.status(200).json(template);
  } catch (error) {
    return res.status(500).json({ message: `Error fetching option template: ${error.message}` });
  }
};

// Create a new option template
export const createOptionTemplate = async (req, res) => {
  try {
    const { nameThai, nameEnglish, isRequired, isMultiple, choices } = req.body;

    if (!nameThai?.trim() && !nameEnglish?.trim()) {
      return res.status(400).json({ message: "Option name in at least one language is required" });
    }

    if (!choices || !Array.isArray(choices) || choices.length === 0) {
      return res.status(400).json({ message: "At least one choice is required" });
    }

    const shop = await Shop.findOne({ owner: req.userId });
    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    // Add order to choices
    const choicesWithOrder = choices.map((choice, index) => ({
      ...choice,
      order: index,
    }));

    const template = await OptionTemplate.create({
      nameThai: nameThai?.trim() || "",
      nameEnglish: nameEnglish?.trim() || "",
      shop: shop._id,
      isRequired: isRequired || false,
      isMultiple: isMultiple || false,
      choices: choicesWithOrder,
    });

    return res.status(201).json(template);
  } catch (error) {
    return res.status(500).json({ message: `Error creating option template: ${error.message}` });
  }
};

// Update an option template
export const updateOptionTemplate = async (req, res) => {
  try {
    const { templateId } = req.params;
    const { nameThai, nameEnglish, isRequired, isMultiple, choices } = req.body;

    const shop = await Shop.findOne({ owner: req.userId });
    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    const template = await OptionTemplate.findOne({
      _id: templateId,
      shop: shop._id,
    });

    if (!template) {
      return res.status(404).json({ message: "Option template not found" });
    }

    if (nameThai !== undefined) template.nameThai = nameThai?.trim() || "";
    if (nameEnglish !== undefined) template.nameEnglish = nameEnglish?.trim() || "";
    if (isRequired !== undefined) template.isRequired = isRequired;
    if (isMultiple !== undefined) template.isMultiple = isMultiple;
    
    if (choices && Array.isArray(choices)) {
      const choicesWithOrder = choices.map((choice, index) => ({
        ...choice,
        order: index,
      }));
      template.choices = choicesWithOrder;
    }

    await template.save();

    return res.status(200).json(template);
  } catch (error) {
    return res.status(500).json({ message: `Error updating option template: ${error.message}` });
  }
};

// Delete an option template
export const deleteOptionTemplate = async (req, res) => {
  try {
    const { templateId } = req.params;

    const shop = await Shop.findOne({ owner: req.userId });
    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    const template = await OptionTemplate.findOne({
      _id: templateId,
      shop: shop._id,
    });

    if (!template) {
      return res.status(404).json({ message: "Option template not found" });
    }

    await OptionTemplate.deleteOne({ _id: templateId });

    return res.status(200).json({ message: "Option template deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: `Error deleting option template: ${error.message}` });
  }
};

