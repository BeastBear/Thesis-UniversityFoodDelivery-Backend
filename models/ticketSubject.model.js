import mongoose from "mongoose";

const ticketSubjectSchema = new mongoose.Schema(
  {
    subject: {
      type: String,
      required: true,
      trim: true,
      unique: true,
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
    priority: {
      type: String,
      enum: ["Low", "Medium", "High"],
      default: "Medium",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true },
);

ticketSubjectSchema.index({ isActive: 1, sortOrder: 1, subject: 1 });

const TicketSubject = mongoose.model("TicketSubject", ticketSubjectSchema);
export default TicketSubject;
