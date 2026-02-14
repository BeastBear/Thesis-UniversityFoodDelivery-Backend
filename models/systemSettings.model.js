import mongoose from "mongoose";

const systemSettingsSchema = new mongoose.Schema(
  {
    isSystemOpen: {
      type: Boolean,
      default: true,
    },
    cafeteriaSettings: [
      {
        name: { type: String, required: true },
        isOpen: { type: Boolean, default: true },
        closeReason: { type: String, default: "" },
        image: { type: String, default: "" },
        location: {
          lat: { type: Number, default: 0 },
          lng: { type: Number, default: 0 },
          address: { type: String, default: "" },
        },
        zoneId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Zone",
          default: null,
        }, // Link to a Zone
      },
    ],
    maintenanceMode: {
      type: Boolean,
      default: false,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    commissionPercentage: {
      type: Number,
      default: 0,
    },
    baseDeliveryFee: {
      type: Number,
      default: 0,
    },
    announcementBanner: {
      type: String,
      default: "",
    },
    pricePerKm: {
      type: Number,
      default: 5,
    },
    deliveryZoneId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Zone",
      default: null,
    },
  },
  { timestamps: true },
);

const SystemSettings = mongoose.model("SystemSettings", systemSettingsSchema);
export default SystemSettings;
