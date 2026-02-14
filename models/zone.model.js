import mongoose from "mongoose";

const zoneSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },
    type: {
      type: String,
      enum: ["Polygon", "Point"], // Polygon for delivery zones, Point for specific landmarks
      required: true,
    },
    coordinates: {
      type: mongoose.Schema.Types.Mixed, // Supports both [[[lng, lat]]] for Polygon and [lng, lat] for Point
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    description: {
      type: String,
      default: "",
    },
  },
  { timestamps: true },
);

// We can store coordinates in GeoJSON format for better compatibility with MongoDB geospatial queries
// But for simplicity based on your request, we'll store raw coordinates and handle logic with Turf.js

const Zone = mongoose.model("Zone", zoneSchema);
export default Zone;
