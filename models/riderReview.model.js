import mongoose from "mongoose";

const riderReviewSchema = new mongoose.Schema(
  {
    rider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    shopOrder: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      // unique: true // One review per shop order?
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    tags: [{
      type: String,
    }],
    comment: {
      type: String,
      default: "",
      maxlength: 500,
    },
    tipAmount: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

// Ensure one review per user per shopOrder for a rider
riderReviewSchema.index({ shopOrder: 1, user: 1, rider: 1 }, { unique: true });

const RiderReview = mongoose.model("RiderReview", riderReviewSchema);
export default RiderReview;
