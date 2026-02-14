import mongoose from "mongoose";

const optionTemplateSchema = new mongoose.Schema(
  {
    nameThai: {
      type: String,
      required: false,
    },
    nameEnglish: {
      type: String,
      required: false,
    },
    shop: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
    },
    isRequired: {
      type: Boolean,
      default: false,
    },
    isMultiple: {
      type: Boolean,
      default: false,
    },
    choices: [
      {
        name: {
          type: String,
          required: true,
        },
        price: {
          type: Number,
          default: 0,
        },
        priceType: {
          type: String,
          enum: ["noChange", "increase", "decrease"],
          default: "noChange",
        },
        order: {
          type: Number,
          default: 0,
        },
        isAvailable: {
          type: Boolean,
          default: true,
        },
      },
    ],
  },
  { timestamps: true }
);

const OptionTemplate = mongoose.model("OptionTemplate", optionTemplateSchema);
export default OptionTemplate;

