import mongoose from "mongoose";
const shopOrderItemSchema = new mongoose.Schema(
  {
    item: { type: mongoose.Schema.Types.ObjectId, ref: "Item", required: true },
    name: String,
    price: Number,
    quantity: Number,
    selectedOptions: { type: mongoose.Schema.Types.Mixed, default: {} },
    additionalRequest: { type: String, default: "" },
  },

  { timestamps: true },
);

const shopOrderSchema = new mongoose.Schema(
  {
    shop: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    subtotal: Number,
    shopOrderItems: [shopOrderItemSchema],
    status: {
      type: String,
      enum: [
        "pending",
        "preparing",
        "out of delivery",
        "delivered",
        "cancelled",
      ],
      default: "pending",
    },
    cancelReason: {
      type: String,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    assignment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DeliveryAssignment",
      default: null,
    },
    assignedDeliveryBoy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    deliveryOtp: {
      type: String,
      default: null,
    },
    otpExpires: {
      type: Date,
      default: null,
    },
    deliveredAt: {
      type: Date,
      default: null,
    },
    preparingStartedAt: {
      type: Date,
      default: null,
    },
    readyForDeliveryAt: {
      type: Date,
      default: null,
    },
    pickedUpAt: {
      type: Date,
      default: null,
    },
    arrivedAtCustomerAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);
const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    paymentMethod: {
      type: String,
      enum: ["cod", "online", "promptpay", "card"],
      required: true,
    },
    deliveryAddress: {
      text: String,
      latitude: Number,
      longitude: Number,
    },
    totalAmount: {
      type: Number,
    },
    deliveryFee: {
      type: Number,
      default: 0,
    },
    paymentFee: {
      type: Number,
      default: 0,
    },
    shopOrders: [shopOrderSchema],
    payment: {
      type: Boolean,
      default: false,
    },
    stripePaymentId: {
      type: String,
      default: "",
    },
    orderId: {
      type: String,
      unique: true,
      sparse: true,
    },
  },
  { timestamps: true },
);

const Order = mongoose.model("Order", orderSchema);
export default Order;
