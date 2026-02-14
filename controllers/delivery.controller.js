import User from "../models/user.model.js";
import Ticket from "../models/ticket.model.js";
import Order from "../models/order.model.js";
import uploadOnCloudinary from "../utils/cloudinary.js";
import { createNotification } from "./notification.controller.js";

// Update Deliverer Online Status
export const updateDelivererStatus = async (req, res) => {
  try {
    const { isOnline } = req.body || {};
    const userId = req.userId;

    const user = await User.findById(userId).select("role isOnline socketId");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.role !== "deliveryBoy") {
      return res
        .status(403)
        .json({ message: "Only delivery users can update this status" });
    }

    user.isOnline = Boolean(isOnline);
    await user.save();

    // If going offline, drop socket id to prevent stale mappings
    if (!user.isOnline && user.socketId) {
      user.socketId = null;
      await user.save();
    }

    return res.status(200).json({ isOnline: user.isOnline });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Update status error: ${error.message}` });
  }
};

// Upload Verification Documents
export const uploadVerificationDocs = async (req, res) => {
  try {
    const userId = req.userId;
    const files = req.files;
    const {
      idNumber = "",
      studentIdNumber = "",
      faculty = "",
      major = "",
    } = req.body || {};

    if (!String(idNumber || "").trim()) {
      return res.status(400).json({ message: "ID Number is required" });
    }

    if (!String(studentIdNumber || "").trim()) {
      return res.status(400).json({ message: "Student ID Number is required" });
    }

    if (!String(faculty || "").trim()) {
      return res.status(400).json({ message: "Faculty is required" });
    }

    if (!String(major || "").trim()) {
      return res.status(400).json({ message: "Major is required" });
    }

    if (!files || !files.studentCard) {
      return res.status(400).json({ message: "Student ID Card is required" });
    }

    const studentCardUrl = await uploadOnCloudinary(files.studentCard[0].path);

    if (!studentCardUrl) {
      return res.status(500).json({ message: "File upload failed" });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      {
        deliveryVerification: {
          status: "pending",
          profile: {
            idNumber: (idNumber || "").trim(),
          },
          studentInfo: {
            studentIdNumber: (studentIdNumber || "").trim(),
            faculty: (faculty || "").trim(),
            major: (major || "").trim(),
          },
          documents: {
            studentCard: studentCardUrl,
          },
          submittedAt: new Date(),
          rejectionReason: "", // Clear previous rejection reason if any
        },
      },
      { new: true },
    );

    await Ticket.findOneAndUpdate(
      {
        type: "verification",
        "verification.targetUser": userId,
        "verification.kind": "delivery",
        status: { $in: ["Open", "In Progress"] },
      },
      {
        $set: {
          user: userId,
          type: "verification",
          category: "Verification",
          subject: "Delivery verification request",
          description: "Delivery verification documents submitted.",
          "verification.kind": "delivery",
          "verification.targetUser": userId,
          "verification.targetRole": "deliveryBoy",
          "verification.submittedAt": new Date(),
        },
      },
      { upsert: true, new: true },
    );

    try {
      const io = req.app.get("io");
      const admins = await User.find({ role: "admin" }).select("_id");
      if (Array.isArray(admins) && admins.length > 0) {
        await Promise.all(
          admins.map((a) =>
            createNotification({
              recipient: a._id,
              title: "New Verification",
              message: "Delivery verification request submitted",
              type: "verification",
              relatedId: userId,
              relatedModel: "User",
            }),
          ),
        );
      }
      if (io) {
        io.to("admins").emit("notification", {
          type: "verification",
          userId: userId.toString(),
          role: "deliveryBoy",
        });
      }
    } catch (e) {
      // ignore
    }

    res.status(200).json({ message: "Verification documents submitted", user });
  } catch (error) {
    res.status(500).json({ message: `Upload error: ${error.message}` });
  }
};

// Get Verification Status
export const getVerificationStatus = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("deliveryVerification");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json(user.deliveryVerification);
  } catch (error) {
    res.status(500).json({ message: `Get status error: ${error.message}` });
  }
};

// Get Financial Summary for Deliverer
export const getFinancialSummary = async (req, res) => {
  try {
    const userId = req.userId;

    // Get today's start and end dates (in local timezone)
    const today = new Date();
    const startOfDay = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    );
    const endOfDay = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + 1,
    );

    // Find all completed orders for this deliverer (all-time)
    const allCompletedOrders = await Order.find({
      "shopOrders.assignedDeliveryBoy": userId,
      "shopOrders.status": "delivered",
    }).select("shopOrders deliveryFee totalAmount createdAt updatedAt");

    // Find today's completed orders for today's income
    const todayCompletedOrders = allCompletedOrders.filter((order) => {
      const deliveredShopOrder = order.shopOrders.find(
        (shopOrder) =>
          shopOrder.assignedDeliveryBoy?.toString() === userId &&
          shopOrder.status === "delivered",
      );
      if (deliveredShopOrder && deliveredShopOrder.deliveredAt) {
        const deliveredDate = new Date(deliveredShopOrder.deliveredAt);
        return deliveredDate >= startOfDay && deliveredDate < endOfDay;
      }
      return false;
    });

    // Calculate today's income (sum of delivery fees from today's deliveries)
    const todayIncome = todayCompletedOrders.reduce((sum, order) => {
      return sum + (order.deliveryFee || 0);
    }, 0);

    // Count all completed tasks (all-time)
    const completedTasks = allCompletedOrders.length;

    // Get user's job credit
    const user = await User.findById(userId).select("jobCredit");
    const jobCredit = user?.jobCredit || 0;

    console.log("Financial summary for user", userId, {
      todayIncome,
      completedTasks,
      jobCredit,
      todayOrdersCount: todayCompletedOrders.length,
      allOrdersCount: allCompletedOrders.length,
    });

    res.status(200).json({
      todayIncome,
      jobCredit,
      todayTip: 0, // Can be implemented later
      incentive: 0, // Can be implemented later
      todayCoins: 0, // Can be implemented later
      completedTasks,
    });
  } catch (error) {
    console.error("Financial summary error:", error);
    res
      .status(500)
      .json({ message: `Get financial summary error: ${error.message}` });
  }
};
