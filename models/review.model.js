import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
  {
    shop: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    shopOrder: {
      type: mongoose.Schema.Types.ObjectId,
      required: false, // Optional for backward compatibility or direct reviews
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      required: false,
      maxlength: 500,
    },
  },
  { timestamps: true }
);

// Ensure one review per user per shop per order
// Note: If you have an existing index on { shop: 1, user: 1 }, you may need to drop it manually in MongoDB
// db.reviews.dropIndex("shop_1_user_1")
reviewSchema.index({ shop: 1, user: 1, shopOrder: 1 }, { unique: true });

const Review = mongoose.model("Review", reviewSchema);
export default Review;
