import mongoose from "mongoose";

const itemSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    nameThai: {
      type: String,
      default: "",
    },
    nameEnglish: {
      type: String,
      default: "",
    },
    image: {
      type: String,
      required: true,
    },
    shop: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
    },
    category: {
      type: String,
      required: true,
    },
    categories: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
    }],
    categoryRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      default: null,
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    unavailabilityReason: {
      type: String,
      enum: ["outOfStockToday", "temporarilyUnavailable"],
      default: null,
    },
    outOfStockDate: {
      type: Date,
      default: null,
    },
    isRecommended: {
      type: Boolean,
      default: false,
    },
    price: {
      type: Number,
      min: 0,
      required: true,
    },
    onlinePrice: {
      type: Number,
      min: 0,
      default: null,
    },
    inStorePrice: {
      type: Number,
      min: 0,
      default: null,
    },
    descriptionThai: {
      type: String,
      default: "",
    },
    descriptionEnglish: {
      type: String,
      default: "",
    },
    selectedOptionTemplates: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "OptionTemplate",
    }],
    foodType: {
      type: String,
      enum: ["veg", "non veg"],
    },
    rating: {
      average: { type: Number, default: 0 },
      count: { type: Number, default: 0 },
    },
    optionSections: [
      {
        sectionName: {
          type: String,
          required: true,
        },
        type: {
          type: String,
          enum: ["single", "multiple"],
          required: true,
          default: "single",
        },
        required: {
          type: Boolean,
          default: false,
        },
        options: [
          {
            name: {
              type: String,
              required: true,
            },
            price: {
              type: Number,
              default: 0,
              min: 0,
            },
          },
        ],
      },
    ],
  },
  { timestamps: true }
);

const Item = mongoose.model("Item", itemSchema);
export default Item;
