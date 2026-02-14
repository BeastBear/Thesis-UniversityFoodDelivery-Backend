import mongoose from "mongoose";
const shopSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    image: {
      type: String,
      required: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    city: {
      type: String,
      required: false,
    },
    cafeteria: {
      type: String,
      required: true,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GlobalCategory",
      required: false,
    },
    state: {
      type: String,
      required: false,
    },
    address: {
      type: String,
      required: false,
    },
    location: {
      latitude: {
        type: Number,
        required: false,
      },
      longitude: {
        type: Number,
        required: false,
      },
    },
    note: {
      type: String,
      required: false,
    },
    shopNumber: {
      type: String,
      required: false,
    },
    businessHours: [
      {
        day: {
          type: String,
          enum: [
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
            "Sunday",
          ],
          required: true,
        },
        timeSlots: [
          {
            openTime: {
              type: String,
              required: false,
            },
            closeTime: {
              type: String,
              required: false,
            },
            is24Hours: {
              type: Boolean,
              default: false,
            },
          },
        ],
        isClosed: {
          type: Boolean,
          default: false,
        },
      },
    ],
    items: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Item",
      },
    ],
    rating: {
      average: { type: Number, default: 0 },
      count: { type: Number, default: 0 },
    },
    isApproved: {
      type: Boolean,
      default: false,
    },
    temporaryClosure: {
      isClosed: { type: Boolean, default: false },
      reopenTime: { type: String, default: null },
      closedUntil: { type: Date, default: null },
    },
    specialHolidays: [
      {
        startDate: { type: Date, required: true },
        endDate: { type: Date, required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    ePaymentAccount: {
      accountName: { type: String, default: "" },
      bank: { type: String, default: "" },
      branch: { type: String, default: "" },
      accountNumber: { type: String, default: "" },
      applicationId: { type: String, default: "" },
    },
    stripeConnectAccountId: {
      type: String,
      default: null,
    },
    stripeBankAccountId: {
      type: String,
      default: null,
    },
    payouts: [
      {
        payoutId: { type: String, required: true },
        amount: { type: Number, required: true },
        currency: { type: String, default: "thb" },
        status: {
          type: String,
          enum: ["pending", "in_transit", "paid", "canceled", "failed"],
          default: "pending",
        },
        method: { type: String, default: "standard" },
        type: {
          type: String,
          enum: ["manual", "automatic"],
          default: "manual",
        }, // "manual" = owner-initiated, "automatic" = system-scheduled
        arrivalDate: { type: Date, default: null },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    payments: [
      {
        chargeId: { type: String, required: true },
        paymentIntentId: { type: String, default: null },
        orderId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Order",
          default: null,
        },
        amount: { type: Number, required: true }, // Amount in THB (not cents)
        currency: { type: String, default: "thb" },
        status: {
          type: String,
          enum: ["succeeded", "pending", "failed", "refunded"],
          default: "succeeded",
        },
        receiptUrl: { type: String, default: null },
        walletCredit: { type: Boolean, default: false }, // Flag to indicate wallet credit from order delivery
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

const Shop = mongoose.model("Shop", shopSchema);
export default Shop;
