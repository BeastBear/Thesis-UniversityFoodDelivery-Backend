import mongoose from "mongoose";

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    shop: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
    },
    order: {
      type: Number,
      default: 0,
    },
    icon: {
      type: String,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Ensure unique category names per shop
categorySchema.index({ shop: 1, name: 1 }, { unique: true });

const Category = mongoose.model("Category", categorySchema);
export default Category;

