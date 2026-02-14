import mongoose from "mongoose";

const ticketMessageSchema = new mongoose.Schema(
  {
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    senderRole: {
      type: String,
      enum: ["PARTNER", "ADMIN"],
      required: true,
    },
    message: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const ticketSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["issue", "verification"],
      default: "issue",
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
    },
    messages: {
      type: [ticketMessageSchema],
      default: [],
    },
    category: {
      type: String,
      enum: [
        "Technical",
        "Order Issue",
        "Account",
        "Payment",
        "Finance",
        "Verification",
        "General",
        "Other",
      ],
      default: "Other",
    },
    verification: {
      kind: {
        type: String,
        enum: ["delivery", "owner"],
        default: null,
      },
      targetUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      targetRole: {
        type: String,
        enum: ["deliveryBoy", "owner"],
        default: null,
      },
      submittedAt: {
        type: Date,
        default: null,
      },
    },
    status: {
      type: String,
      enum: ["Open", "In Progress", "Resolved", "Closed"],
      default: "Open",
    },
    priority: {
      type: String,
      enum: ["Low", "Medium", "High"],
      default: "Medium",
    },
    adminResponse: {
      type: String,
      default: "",
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    resolvedAt: {
      type: Date,
    },
  },
  { timestamps: true },
);

const Ticket = mongoose.model("Ticket", ticketSchema);
export default Ticket;
