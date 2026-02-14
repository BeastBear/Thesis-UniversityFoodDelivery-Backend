import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: [
        "order_update",
        "system",
        "promo",
        "delivery_assignment",
        "ticket",
        "verification",
        "payout",
      ],
      default: "system",
    },
    relatedId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    relatedModel: {
      type: String,
      enum: [
        "Order",
        "User",
        "Shop",
        "Ticket",
        "PayoutRequest",
        "DeliveryAssignment",
      ],
      default: "Order",
    },
    isRead: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

const Notification = mongoose.model("Notification", notificationSchema);
export default Notification;
