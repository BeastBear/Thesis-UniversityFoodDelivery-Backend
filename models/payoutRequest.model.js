import mongoose from "mongoose";

const payoutRequestSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    shop: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
      default: null,
    },
    requesterType: {
      type: String,
      enum: ["user", "shop", "deliverer"],
      default: "user",
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: "thb",
    },
    method: {
      type: String,
      default: "standard",
    },
    bankInfo: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "paid"],
      default: "pending",
    },
    adminNote: {
      type: String,
      default: "",
    },
    transactionId: {
      type: String,
      default: null, // Stripe Payout ID or Manual Reference
    },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    processedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

const PayoutRequest = mongoose.model("PayoutRequest", payoutRequestSchema);
export default PayoutRequest;
