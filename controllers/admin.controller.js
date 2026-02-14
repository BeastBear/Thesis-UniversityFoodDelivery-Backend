import Item from "../models/item.model.js";
import User from "../models/user.model.js";
import Shop from "../models/shop.model.js";
import Order from "../models/order.model.js";
import SystemSettings from "../models/systemSettings.model.js";
import PayoutRequest from "../models/payoutRequest.model.js";
import Ticket from "../models/ticket.model.js";
import stripe from "../config/stripe.js";

import uploadOnCloudinary from "../utils/cloudinary.js";

// Get Admin Stats
export const getAdminStats = async (req, res) => {
  try {
    const [totalUsers, totalShops, totalOrders] = await Promise.all([
      User.countDocuments({}),
      Shop.countDocuments({}),
      Order.countDocuments({}),
    ]);

    const activeOrders = await Order.countDocuments({
      shopOrders: {
        $elemMatch: {
          status: {
            $nin: [
              "delivered",
              "Delivered",
              "cancelled",
              "canceled",
              "Cancelled",
              "Canceled",
            ],
          },
        },
      },
    });

    return res.status(200).json({
      totalUsers,
      totalShops,
      totalOrders,
      activeOrders,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Get admin stats error: ${error.message}` });
  }
};

// Get All Users
export const getAllUsers = async (req, res) => {
  try {
    const users = await User.find({})
      .select("-password")
      .sort({ createdAt: -1 });
    return res.status(200).json(users);
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Get users error: ${error.message}` });
  }
};

// Get All Shops
export const getAllShops = async (req, res) => {
  try {
    const shops = await Shop.find({}).populate(
      "owner",
      "fullName email mobile",
    );
    return res.status(200).json(shops);
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Get shops error: ${error.message}` });
  }
};

// Approve Shop
export const approveShop = async (req, res) => {
  try {
    const { shopId } = req.params;
    const { isApproved = true } = req.body;
    const shop = await Shop.findByIdAndUpdate(
      shopId,
      { isApproved: !!isApproved },
      { new: true },
    ).populate("owner", "fullName email mobile");

    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    return res.status(200).json({ message: "Shop approval updated", shop });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Approve shop error: ${error.message}` });
  }
};

// Get All Orders
export const getAllOrders = async (req, res) => {
  try {
    const orders = await Order.find({})
      .populate("user", "fullName email mobile")
      .populate("shopOrders.shop")
      .populate("shopOrders.assignedDeliveryBoy", "fullName email mobile")
      .sort({ createdAt: -1 });
    return res.status(200).json(orders);
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Get orders error: ${error.message}` });
  }
};

// Admin Update Order Status
export const adminUpdateOrderStatus = async (req, res) => {
  try {
    const { orderId, shopOrderId } = req.params;
    const { status, cancelReason } = req.body;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const shopOrder = order.shopOrders.find(
      (so) => so._id.toString() === shopOrderId,
    );

    if (!shopOrder) {
      return res.status(404).json({ message: "Shop order not found" });
    }

    if (typeof status === "string" && status.trim()) {
      shopOrder.status = status.trim();
    }

    if (
      (shopOrder.status === "cancelled" || shopOrder.status === "canceled") &&
      typeof cancelReason === "string"
    ) {
      shopOrder.cancelReason = cancelReason;
    }

    await order.save();

    return res
      .status(200)
      .json({ message: "Order status updated by admin", order });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Admin update order error: ${error.message}` });
  }
};

// Get System Settings
export const getSystemSettings = async (req, res) => {
  try {
    let settings = await SystemSettings.findOne()
      .populate("deliveryZoneId")
      .populate("cafeteriaSettings.zoneId");

    if (!settings) {
      settings = await SystemSettings.create({});
    }

    return res.status(200).json(settings);
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Get settings error: ${error.message}` });
  }
};

// Update System Settings
export const updateSystemSettings = async (req, res) => {
  try {
    const {
      isSystemOpen,
      cafeteriaSettings,
      maintenanceMode,
      commissionPercentage,
      baseDeliveryFee,
      announcementBanner,
      pricePerKm,
      deliveryZoneId,
    } = req.body;

    let settings = await SystemSettings.findOne();
    if (!settings) {
      settings = new SystemSettings();
    }

    if (isSystemOpen !== undefined) settings.isSystemOpen = isSystemOpen;
    if (cafeteriaSettings !== undefined) {
      settings.cafeteriaSettings = cafeteriaSettings;
      settings.markModified("cafeteriaSettings");
    }
    if (maintenanceMode !== undefined)
      settings.maintenanceMode = maintenanceMode;
    if (commissionPercentage !== undefined)
      settings.commissionPercentage = commissionPercentage;
    if (baseDeliveryFee !== undefined)
      settings.baseDeliveryFee = baseDeliveryFee;
    if (announcementBanner !== undefined)
      settings.announcementBanner = announcementBanner;
    if (pricePerKm !== undefined) settings.pricePerKm = pricePerKm;
    if (deliveryZoneId !== undefined) settings.deliveryZoneId = deliveryZoneId;
    settings.updatedBy = req.userId;

    const savedSettings = await settings.save();
    await savedSettings.populate("deliveryZoneId");
    await savedSettings.populate("cafeteriaSettings.zoneId");
    return res.status(200).json(savedSettings);
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Update settings error: ${error.message}` });
  }
};

// Get Pending Verifications (Delivery)
export const getPendingVerifications = async (req, res) => {
  try {
    const users = await User.find({
      role: "deliveryBoy",
      "deliveryVerification.status": "pending",
    }).select("-password");
    return res.status(200).json(users);
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Get pending verifications error: ${error.message}` });
  }
};

// Get Pending Owner Verifications
export const getPendingOwnerVerifications = async (req, res) => {
  try {
    const users = await User.find({
      role: "owner",
      "ownerVerification.status": "pending",
    }).select("-password");
    return res.status(200).json(users);
  } catch (error) {
    return res.status(500).json({
      message: `Get pending owner verifications error: ${error.message}`,
    });
  }
};

// Upload Image (Admin)
export const uploadImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No image file uploaded" });
    }

    const imageUrl = await uploadOnCloudinary(req.file.path);
    if (!imageUrl) {
      return res.status(500).json({ message: "Image upload failed" });
    }

    return res.status(200).json({ imageUrl });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Upload image error: ${error.message}` });
  }
};

// Verify Delivery Boy
export const verifyDeliveryBoy = async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, rejectionReason } = req.body; // status: "verified" or "rejected"

    const updateData = {
      "deliveryVerification.status": status,
      "deliveryVerification.verifiedAt": new Date(),
    };

    if (status === "rejected") {
      updateData["deliveryVerification.rejectionReason"] =
        rejectionReason || "Documents rejected by admin";
    } else {
      updateData["deliveryVerification.rejectionReason"] = "";
    }

    const user = await User.findByIdAndUpdate(userId, updateData, {
      new: true,
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const ticketStatus = status === "verified" ? "Resolved" : "Closed";
    const responseText =
      status === "verified"
        ? "Verification approved by admin."
        : rejectionReason || "Documents rejected by admin";

    await Ticket.findOneAndUpdate(
      {
        type: "verification",
        "verification.targetUser": userId,
        "verification.kind": "delivery",
        status: { $in: ["Open", "In Progress"] },
      },
      {
        $set: {
          status: ticketStatus,
          adminResponse: responseText,
          resolvedBy: req.userId,
          resolvedAt: new Date(),
        },
      },
    );

    res.status(200).json({ message: `Delivery boy ${status}`, user });
  } catch (error) {
    res
      .status(500)
      .json({ message: `Verify delivery boy error: ${error.message}` });
  }
};

// Verify Owner
export const verifyOwner = async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, rejectionReason } = req.body; // status: "verified" or "rejected"

    const updateData = {
      "ownerVerification.status": status,
      "ownerVerification.verifiedAt": new Date(),
    };

    if (status === "rejected") {
      updateData["ownerVerification.rejectionReason"] =
        rejectionReason || "Documents rejected by admin";
    } else {
      updateData["ownerVerification.rejectionReason"] = "";
    }

    const user = await User.findByIdAndUpdate(userId, updateData, {
      new: true,
    }).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const ticketStatus = status === "verified" ? "Resolved" : "Closed";
    const responseText =
      status === "verified"
        ? "Verification approved by admin."
        : rejectionReason || "Documents rejected by admin";

    await Ticket.findOneAndUpdate(
      {
        type: "verification",
        "verification.targetUser": userId,
        "verification.kind": "owner",
        status: { $in: ["Open", "In Progress"] },
      },
      {
        $set: {
          status: ticketStatus,
          adminResponse: responseText,
          resolvedBy: req.userId,
          resolvedAt: new Date(),
        },
      },
    );

    res.status(200).json({ message: `Owner ${status}`, user });
  } catch (error) {
    res.status(500).json({ message: `Verify owner error: ${error.message}` });
  }
};

// Toggle User Suspension
export const toggleUserSuspension = async (req, res) => {
  try {
    const { userId } = req.params;
    // ... existing code
    const { isSuspended } = req.body;

    const user = await User.findByIdAndUpdate(
      userId,
      { isSuspended },
      { new: true },
    ).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      message: `User suspension ${isSuspended ? "activated" : "deactivated"}`,
      user,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: `Toggle suspension error: ${error.message}` });
  }
};

// Update User Role
export const updateUserRole = async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    const allowedRoles = ["user", "admin", "owner", "deliveryBoy"];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        message: `Invalid role. Allowed roles: ${allowedRoles.join(", ")}`,
      });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { role },
      { new: true },
    ).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({ message: "User role updated", user });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Update user role error: ${error.message}` });
  }
};

// Toggle Shop Closure (Force Close/Open)
export const toggleShopClosure = async (req, res) => {
  try {
    const { shopId } = req.params;
    const { temporaryClosure } = req.body;

    const isClosed =
      typeof temporaryClosure === "boolean"
        ? temporaryClosure
        : !!temporaryClosure?.isClosed;

    const shop = await Shop.findByIdAndUpdate(
      shopId,
      {
        $set: {
          temporaryClosure: {
            isClosed,
            reopenTime: null,
            closedUntil: null,
          },
        },
      },
      { new: true },
    );

    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    res.status(200).json({ message: "Shop closure status updated", shop });
  } catch (error) {
    res
      .status(500)
      .json({ message: `Toggle shop closure error: ${error.message}` });
  }
};

// Admin Update Item
export const adminUpdateItem = async (req, res) => {
  try {
    const { itemId } = req.params;
    const updateData = req.body;

    const item = await Item.findByIdAndUpdate(itemId, updateData, {
      new: true,
    });

    if (!item) {
      return res.status(404).json({ message: "Item not found" });
    }

    res.status(200).json({ message: "Item updated by admin", item });
  } catch (error) {
    res
      .status(500)
      .json({ message: `Admin update item error: ${error.message}` });
  }
};

// Admin Re-assign Rider
export const adminReassignRider = async (req, res) => {
  try {
    const { orderId, shopOrderId } = req.params;
    const { newRiderId } = req.body;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const shopOrder = order.shopOrders.find(
      (so) => so._id.toString() === shopOrderId,
    );
    if (!shopOrder) {
      return res.status(404).json({ message: "Shop order not found" });
    }

    // Optionally check if new rider exists and is available
    if (newRiderId) {
      const newRider = await User.findById(newRiderId);
      if (!newRider || newRider.role !== "deliveryBoy") {
        return res.status(400).json({ message: "Invalid rider ID" });
      }
      shopOrder.assignedDeliveryBoy = newRiderId;
      shopOrder.status = "preparing"; // Reset status to preparing so new rider can accept? Or keep as is?
      // Assuming re-assign means just changing the pointer for now.
      // In a real scenario, you might need to notify the new rider.
    } else {
      // Unassign
      shopOrder.assignedDeliveryBoy = null;
      shopOrder.status = "ready"; // Back to ready pool
    }

    await order.save();
    res.status(200).json({ message: "Rider reassigned successfully", order });
  } catch (error) {
    res.status(500).json({ message: `Reassign rider error: ${error.message}` });
  }
};

// Get Financial Stats & Payouts
export const getFinancialStats = async (req, res) => {
  try {
    // Fetch all delivered orders for financial calculations
    const orders = await Order.find({ "shopOrders.status": "delivered" });
    const settings = await SystemSettings.findOne()
      .select("commissionPercentage")
      .lean();

    // Get commission percentage from system settings
    const commissionPercentage = Number(settings?.commissionPercentage ?? 0);
    const commissionRate = Number.isFinite(commissionPercentage)
      ? Math.min(Math.max(commissionPercentage, 0), 100) / 100
      : 0;

    // Calculate Total GMV: Sum of totalAmount (subtotal + deliveryFee) for all delivered orders
    // This represents the gross merchandise value including delivery fees
    const totalGMV = orders.reduce((acc, order) => {
      return acc + (Number(order.totalAmount) || 0);
    }, 0);

    // Calculate Platform Net Income:
    // 1. Commission on food subtotals (percentage of food value, not including delivery fees)
    // 2. Payment fees (if any - currently 0, but included for future-proofing)
    // Note: Delivery fees go to delivery boys, not the platform
    
    // Sum food subtotals from all shopOrders for commission calculation
    const totalFoodSubtotal = orders.reduce((acc, order) => {
      return (
        acc +
        order.shopOrders.reduce((soAcc, so) => soAcc + (Number(so.subtotal) || 0), 0)
      );
    }, 0);

    // Calculate commission revenue
    const commissionRevenue = Math.round(totalFoodSubtotal * commissionRate * 100) / 100;

    // Sum payment fees (if any - currently 0 in the system)
    const totalPaymentFees = orders.reduce((acc, order) => {
      return acc + (Number(order.paymentFee) || 0);
    }, 0);

    // Total platform net income = commission + payment fees
    const totalRevenue = Math.round((commissionRevenue + totalPaymentFees) * 100) / 100;

    const pendingPayouts = await PayoutRequest.find({ status: "pending" })
      .populate("user", "fullName email mobile role")
      .populate("shop", "name")
      .sort({ createdAt: -1 });

    const payoutHistory = await PayoutRequest.find({
      status: { $ne: "pending" },
    })
      .populate("user", "fullName email mobile role")
      .populate("shop", "name")
      .sort({ createdAt: -1 })
      .limit(50);

    res.status(200).json({
      totalGMV,
      totalRevenue,
      pendingPayouts,
      payoutHistory,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: `Get financial stats error: ${error.message}` });
  }
};

// Process Payout Request
export const processPayoutRequest = async (req, res) => {
  try {
    const { payoutId } = req.params;
    const { status, adminNote, transactionId } = req.body; // status: "approved", "rejected", "paid" (or "completed")

    // Map "completed" to "paid" for backward compatibility
    const normalizedStatus = status === "completed" ? "paid" : status;

    if (!["approved", "rejected", "paid"].includes(normalizedStatus)) {
      return res.status(400).json({
        message: "Invalid status. Must be 'approved', 'rejected', or 'paid' (or 'completed')",
      });
    }

    const payout = await PayoutRequest.findByIdAndUpdate(
      payoutId,
      {
        status: normalizedStatus,
        adminNote,
        transactionId,
        processedBy: req.userId,
        processedAt: new Date(),
      },
      { new: true },
    )
      .populate("user", "fullName email mobile role")
      .populate("shop", "name");

    if (!payout) {
      return res.status(404).json({ message: "Payout request not found" });
    }

    const embeddedStatusByAdminStatus = {
      approved: "in_transit",
      paid: "paid",
      rejected: "failed",
    };

    const embeddedStatus = embeddedStatusByAdminStatus[normalizedStatus] || null;
    const payoutRef = transactionId || payout.transactionId;

    if (embeddedStatus && payoutRef) {
      if (payout.requesterType === "shop" && payout.shop) {
        await Shop.updateOne(
          { _id: payout.shop, "payouts.payoutId": payoutRef },
          { $set: { "payouts.$.status": embeddedStatus } },
        );
      } else {
        // Handle both "user" and "deliverer" requester types
        await User.updateOne(
          { _id: payout.user, "payouts.payoutId": payoutRef },
          { $set: { "payouts.$.status": embeddedStatus } },
        );
      }
    }

    // When admin marks payout as "paid" (completed), create Stripe payout
    if (normalizedStatus === "paid") {
      try {
        const amountInCents = Math.round(payout.amount * 100); // Convert THB to cents
        
        // Get recipient information based on requester type
        let recipientName = "";
        let metadata = {};
        let bankAccountId = null;

        if (payout.requesterType === "shop" && payout.shop) {
          const shop = await Shop.findById(payout.shop);
          if (shop) {
            recipientName = shop.name;
            bankAccountId = shop.stripeBankAccountId;
            metadata = {
              shopId: shop._id.toString(),
              shopName: shop.name,
              accountName: shop.ePaymentAccount?.accountName || "",
              accountNumber: shop.ePaymentAccount?.accountNumber || "",
              bank: shop.ePaymentAccount?.bank || "",
              payoutRequestId: payout._id.toString(),
              requesterType: "shop",
            };
          }
        } else if (payout.user) {
          const user = await User.findById(payout.user);
          if (user) {
            recipientName = user.fullName;
            bankAccountId = user.stripeBankAccountId;
            metadata = {
              userId: user._id.toString(),
              userName: user.fullName,
              accountName: user.ePaymentAccount?.accountName || "",
              accountNumber: user.ePaymentAccount?.accountNumber || "",
              bank: user.ePaymentAccount?.bank || "",
              payoutRequestId: payout._id.toString(),
              requesterType: payout.requesterType || "deliverer",
            };
          }
        }

        // Create Stripe payout
        const stripePayout = await stripe.payouts.create({
          amount: amountInCents,
          currency: "thb",
          method: payout.method === "instant" ? "instant" : "standard",
          statement_descriptor: `Payout for ${recipientName}`.substring(0, 22), // Max 22 chars
          description: `Payout request ${payout._id} for ${recipientName}`,
          metadata,
          ...(bankAccountId && { destination: bankAccountId }),
        });

        console.log("Stripe payout created:", {
          stripePayoutId: stripePayout.id,
          amount: stripePayout.amount,
          status: stripePayout.status,
          recipientName,
          payoutRequestId: payout._id.toString(),
        });

        // Update payout request with Stripe payout ID
        payout.transactionId = stripePayout.id;
        await payout.save();

        // Update the embedded payout record with Stripe payout ID
        if (payoutRef && embeddedStatus) {
          if (payout.requesterType === "shop" && payout.shop) {
            await Shop.updateOne(
              { _id: payout.shop, "payouts.payoutId": payoutRef },
              { 
                $set: { 
                  "payouts.$.status": embeddedStatus,
                  "payouts.$.transactionId": stripePayout.id,
                } 
              },
            );
          } else {
            await User.updateOne(
              { _id: payout.user, "payouts.payoutId": payoutRef },
              { 
                $set: { 
                  "payouts.$.status": embeddedStatus,
                  "payouts.$.transactionId": stripePayout.id,
                } 
              },
            );
          }
        }

        // Refresh payout data
        await payout.populate("user", "fullName email mobile role");
        await payout.populate("shop", "name");

        return res.status(200).json({
          message: `Payout request completed and Stripe payout created`,
          payout: {
            ...payout.toObject(),
            transactionId: stripePayout.id,
          },
          stripePayout: {
            id: stripePayout.id,
            status: stripePayout.status,
            amount: stripePayout.amount / 100, // Convert back to THB
            arrivalDate: stripePayout.arrival_date 
              ? new Date(stripePayout.arrival_date * 1000) 
              : null,
          },
        });
      } catch (stripeError) {
        console.error("Stripe payout creation error:", stripeError);
        
        // If Stripe payout fails, still update the status but mark it as needing attention
        return res.status(500).json({
          message: `Payout status updated but Stripe payout failed: ${stripeError.message}`,
          payout,
          error: {
            type: stripeError.type,
            code: stripeError.code,
            message: stripeError.message,
          },
        });
      }
    }

    // When admin marks payout as "paid" (completed), the wallet balance is effectively deducted
    // The wallet calculation already accounts for this by subtracting completed (paid) payouts
    // No additional deduction needed here - the status update is sufficient
    // The wallet balance calculation formula handles this:
    // - For shops: Wallet = Total Shop Earnings - Completed Payouts - Pending Payouts
    // - For delivery boys: Wallet = Total Delivery Fees - Completed Payouts - Pending Payouts

    res.status(200).json({
      message: `Payout request ${normalizedStatus === "paid" ? "completed" : normalizedStatus}`,
      payout,
    });
  } catch (error) {
    res.status(500).json({ message: `Process payout error: ${error.message}` });
  }
};

export const migrateVerifiedOwnersToShops = async (req, res) => {
  try {
    const verifiedOwners = await User.find({
      role: "owner",
      "ownerVerification.status": "verified",
    }).select("ownerVerification");

    let created = 0;
    let skipped = 0;
    const errors = [];

    const defaultBusinessHours = [
      {
        day: "Monday",
        timeSlots: [
          { openTime: "09:00", closeTime: "17:00", is24Hours: false },
        ],
        isClosed: false,
      },
      {
        day: "Tuesday",
        timeSlots: [
          { openTime: "09:00", closeTime: "17:00", is24Hours: false },
        ],
        isClosed: false,
      },
      {
        day: "Wednesday",
        timeSlots: [
          { openTime: "09:00", closeTime: "17:00", is24Hours: false },
        ],
        isClosed: false,
      },
      {
        day: "Thursday",
        timeSlots: [
          { openTime: "09:00", closeTime: "17:00", is24Hours: false },
        ],
        isClosed: false,
      },
      {
        day: "Friday",
        timeSlots: [
          { openTime: "09:00", closeTime: "17:00", is24Hours: false },
        ],
        isClosed: false,
      },
      {
        day: "Saturday",
        timeSlots: [
          { openTime: "09:00", closeTime: "17:00", is24Hours: false },
        ],
        isClosed: false,
      },
      {
        day: "Sunday",
        timeSlots: [
          { openTime: "09:00", closeTime: "17:00", is24Hours: false },
        ],
        isClosed: false,
      },
    ];

    for (const owner of verifiedOwners) {
      try {
        const existingShop = await Shop.findOne({ owner: owner._id });
        if (existingShop) {
          skipped += 1;
          continue;
        }

        const restaurant = owner.ownerVerification?.restaurant || {};
        const bank = owner.ownerVerification?.bank || {};

        await Shop.create({
          owner: owner._id,
          name: restaurant?.name || "Restaurant",
          image: restaurant?.photo || "https://placehold.co/600x400",
          cafeteria: restaurant?.cafeteria || "Cafeteria 1",
          shopNumber: restaurant?.restaurantNumber || "",
          note: restaurant?.description || "",
          businessHours: defaultBusinessHours,
          isApproved: true,
          ePaymentAccount: {
            accountName: bank?.accountName || "",
            bank: bank?.bank || "",
            branch: bank?.branch || "",
            accountNumber: bank?.accountNumber || "",
            applicationId: bank?.applicationId || "",
          },
        });

        created += 1;
      } catch (e) {
        errors.push({
          ownerId: owner._id?.toString(),
          message: e?.message || String(e),
        });
      }
    }

    return res.status(200).json({
      message: "Migration completed",
      totalVerifiedOwners: verifiedOwners.length,
      created,
      skipped,
      errors,
    });
  } catch (error) {
    return res.status(500).json({
      message: `Migrate verified owners error: ${error.message}`,
    });
  }
};
