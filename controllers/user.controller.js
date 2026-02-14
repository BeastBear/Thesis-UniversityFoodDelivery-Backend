import User from "../models/user.model.js";
import Shop from "../models/shop.model.js";
import Order from "../models/order.model.js";
import Ticket from "../models/ticket.model.js";
import PayoutRequest from "../models/payoutRequest.model.js";
import { createNotification } from "./notification.controller.js";
import stripe from "../config/stripe.js";
import uploadOnCloudinary from "../utils/cloudinary.js";
import webpush from "web-push";

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ||
      `mailto:${process.env.EMAIL || "admin@example.com"}`,
    vapidPublicKey,
    vapidPrivateKey,
  );
}

// Get Current User
export const getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json(user);
  } catch (error) {
    res
      .status(500)
      .json({ message: `Get current user error: ${error.message}` });
  }
};

export const getOwnerVerification = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    return res
      .status(200)
      .json({ ownerVerification: user.ownerVerification || null });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Get owner verification error: ${error.message}` });
  }
};

export const submitOwnerVerification = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const shop = await Shop.findOne({ owner: req.userId });

    const {
      fullName,
      idNumber,
      restaurantName,
      cafeteria,
      restaurantNumber,
      restaurantDescription,
      bankAccountName,
      bankName,
      bankAccountNumber,
    } = req.body;

    const normalizedKycName = (fullName || "").trim().toLowerCase();
    const submittedBankAccountName = (bankAccountName || "").trim();
    const normalizedBankName = submittedBankAccountName.toLowerCase();

    if (!normalizedKycName) {
      return res.status(400).json({ message: "Full Name is required" });
    }

    if (!idNumber) {
      return res
        .status(400)
        .json({ message: "ID Card / Passport Number is required" });
    }

    if (!submittedBankAccountName) {
      return res
        .status(400)
        .json({ message: "Please complete your bank account details first" });
    }

    if (normalizedKycName !== normalizedBankName) {
      return res.status(400).json({
        message:
          "Full Name must match Bank Account Name. Please make sure both names are identical.",
      });
    }

    const files = req.files || {};

    const uploadFirst = async (fieldName) => {
      const fileArr = files[fieldName];
      if (!fileArr || !fileArr[0]) return "";
      const url = await uploadOnCloudinary(fileArr[0].path);
      return url || "";
    };

    const existingOwnerVerification = user.ownerVerification || {};
    const existingRestaurantPhoto =
      existingOwnerVerification?.restaurant?.photo || "";
    const existingBookbankHeaderPhoto =
      existingOwnerVerification?.financial?.bookbankHeaderPhoto || "";

    const restaurantPhoto =
      (await uploadFirst("restaurantPhoto")) || existingRestaurantPhoto;
    const bookbankHeaderPhoto =
      (await uploadFirst("bookbankHeaderPhoto")) || existingBookbankHeaderPhoto;

    if (!restaurantName) {
      return res.status(400).json({ message: "Restaurant name is required" });
    }

    if (!cafeteria) {
      return res.status(400).json({ message: "Cafeteria is required" });
    }

    if (!restaurantNumber) {
      return res.status(400).json({ message: "Restaurant number is required" });
    }

    if (!restaurantPhoto) {
      return res.status(400).json({
        message: "Please upload a restaurant photo",
      });
    }

    user.ownerVerification = {
      status: "pending",
      rejectionReason: "",
      submittedAt: new Date(),
      verifiedAt: null,
      owner: {
        fullName: user.fullName || "",
        email: user.email || "",
        mobile: user.mobile || "",
      },
      restaurant: {
        name: restaurantName || "",
        photo: restaurantPhoto || "",
        cafeteria: cafeteria || "",
        restaurantNumber: restaurantNumber || "",
        description: restaurantDescription || "",
      },
      bank: {
        accountName: submittedBankAccountName || "",
        bank: (bankName || "").trim(),
        branch: shop?.ePaymentAccount?.branch || "",
        accountNumber: (bankAccountNumber || "").trim(),
        applicationId: shop?.ePaymentAccount?.applicationId || "",
      },
      kyc: {
        fullName: fullName || "",
        idNumber: idNumber || "",
      },
      financial: {
        bookbankHeaderPhoto,
      },
    };

    await user.save();

    await Ticket.findOneAndUpdate(
      {
        type: "verification",
        "verification.targetUser": req.userId,
        "verification.kind": "owner",
        status: { $in: ["Open", "In Progress"] },
      },
      {
        $set: {
          user: req.userId,
          type: "verification",
          category: "Verification",
          subject: "Owner verification request",
          description: "Owner verification information submitted.",
          "verification.kind": "owner",
          "verification.targetUser": req.userId,
          "verification.targetRole": "owner",
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
              message: "Owner verification request submitted",
              type: "verification",
              relatedId: req.userId,
              relatedModel: "User",
            }),
          ),
        );
      }
      if (io) {
        io.to("admins").emit("notification", {
          type: "verification",
          userId: req.userId.toString(),
          role: "owner",
        });
      }
    } catch (e) {
      // ignore
    }

    return res.status(200).json({
      message: "Verification submitted successfully",
      ownerVerification: user.ownerVerification,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Submit owner verification error: ${error.message}` });
  }
};

// Update User Profile
export const updateUserProfile = async (req, res) => {
  try {
    const { fullName, email, mobile } = req.body;
    const userId = req.userId;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (req.file) {
      const imageUrl = await uploadOnCloudinary(req.file.path);
      if (imageUrl) {
        user.profileImage = imageUrl;
      }
    }

    if (fullName) user.fullName = fullName;
    if (email) user.email = email;
    if (mobile) user.mobile = mobile;

    await user.save();
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: `Update profile error: ${error.message}` });
  }
};

// Update User Location
export const updateUserLocation = async (req, res) => {
  try {
    const { lat, lon, lng, address } = req.body;
    const userId = req.userId;

    const latitude = Number(lat);
    const longitude = Number(lon ?? lng);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ message: "Invalid location coordinates" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.location = {
      type: "Point",
      coordinates: [longitude, latitude],
    };

    if (typeof address === "string" && address.trim()) {
      user.currentAddress = address.trim();
    }

    await user.save();
    res.status(200).json({
      message: "Location updated successfully",
      address: user.currentAddress || "",
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: `Update location error: ${error.message}` });
  }
};

// Create Credit Top Up Session
export const createCreditTopUpSession = async (req, res) => {
  try {
    const { amount } = req.body;
    const userId = req.userId;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "thb",
            product_data: {
              name: "Job Credit Top Up",
            },
            unit_amount: amount * 100,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.CLIENT_URL}/delivery-finance?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/delivery-finance?payment=cancel`,
      metadata: {
        userId,
        type: "topup",
      },
    });

    res.status(200).json({ id: session.id });
  } catch (error) {
    res
      .status(500)
      .json({ message: `Create top up session error: ${error.message}` });
  }
};

// Verify Credit Top Up
export const verifyCreditTopUp = async (req, res) => {
  try {
    const { sessionId } = req.body;
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === "paid") {
      const userId = session.metadata.userId;
      const amount = session.amount_total / 100; // Convert back to main currency unit

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Check if this session was already processed (optional but recommended)
      // For now, we just add credit. In a real app, you should store transaction IDs to prevent double counting.

      user.jobCredit += amount;
      await user.save();

      // You might want to emit a socket event here if you have socket instance access
      // req.io.to(user.socketId).emit('job-credit-updated', { jobCredit: user.jobCredit });

      res
        .status(200)
        .json({ message: "Top up successful", jobCredit: user.jobCredit });
    } else {
      res.status(400).json({ message: "Payment not successful" });
    }
  } catch (error) {
    res.status(500).json({ message: `Verify top up error: ${error.message}` });
  }
};

// Update Delivery Boy Bank Account
export const updateDeliveryBoyBankAccount = async (req, res) => {
  try {
    const { accountName, bank, branch, accountNumber, applicationId } =
      req.body;
    const userId = req.userId;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.ePaymentAccount = {
      accountName,
      bank,
      branch,
      accountNumber,
      applicationId,
    };

    await user.save();
    res.status(200).json({
      message: "Bank account updated successfully",
      ePaymentAccount: user.ePaymentAccount,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: `Update bank account error: ${error.message}` });
  }
};

// Withdraw To Bank Delivery Boy
export const withdrawToBankDeliveryBoy = async (req, res) => {
  try {
    const { amount } = req.body;
    const userId = req.userId;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!user.ePaymentAccount?.accountNumber || !user.ePaymentAccount?.bank) {
      return res.status(400).json({
        message: "Please complete your bank account details first",
      });
    }

    if (user.jobCredit < amount) {
      return res.status(400).json({ message: "Insufficient credit" });
    }

    // Deduct credit immediately
    user.jobCredit -= amount;

    // Create a payout record
    const payout = {
      payoutId: `payout_${Date.now()}`, // Placeholder ID
      amount,
      status: "pending",
      arrivalDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Est 7 days
    };

    user.payouts.push(payout);
    await user.save();

    const bankInfo = `${user.ePaymentAccount.bank} • ${user.ePaymentAccount.accountNumber}`;
    const payoutReq = await PayoutRequest.create({
      user: userId,
      requesterType: "user",
      amount,
      currency: "thb",
      method: "standard",
      bankInfo,
      status: "pending",
      transactionId: payout.payoutId,
    });

    try {
      const io = req.app.get("io");
      const admins = await User.find({ role: "admin" }).select("_id");
      if (Array.isArray(admins) && admins.length > 0) {
        await Promise.all(
          admins.map((a) =>
            createNotification({
              recipient: a._id,
              title: "New Payout Request",
              message: `Delivery payout pending: ฿${Number(amount || 0).toFixed(2)}`,
              type: "payout",
              relatedId: payoutReq?._id,
              relatedModel: "PayoutRequest",
            }),
          ),
        );
      }
      if (io) {
        io.to("admins").emit("notification", {
          type: "payout",
          payoutRequestId: payoutReq?._id?.toString(),
        });
      }
    } catch (e) {
      // ignore
    }

    res.status(200).json({
      message: "Withdrawal request submitted",
      jobCredit: user.jobCredit,
      payout,
    });
  } catch (error) {
    res.status(500).json({ message: `Withdrawal error: ${error.message}` });
  }
};

// Request Payout from Wallet Balance (for deliverers)
export const requestPayoutFromWallet = async (req, res) => {
  try {
    const { amount } = req.body;
    const userId = req.userId;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: "Invalid payout amount" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if user is a delivery boy
    if (user.role !== "deliveryBoy") {
      return res.status(403).json({
        message: "Only delivery boys can request wallet payouts",
      });
    }

    // Check if bank account is set up
    if (!user.ePaymentAccount?.accountNumber || !user.ePaymentAccount?.bank) {
      return res.status(400).json({
        message: "Please complete your bank account details first",
      });
    }

    // Calculate wallet balance
    // Wallet = Total Earnings (delivery fees from ONLINE payment orders only) - Total Withdrawals - Pending Withdrawals
    // COD orders don't add to wallet (rider collects cash)
    const orders = await Order.find({
      "shopOrders.assignedDeliveryBoy": userId,
      "shopOrders.status": "delivered",
      // Only include online payment methods (exclude COD)
      paymentMethod: { $in: ["online", "promptpay", "card"] },
    });

    let totalEarnings = 0;
    const processedOrderIds = new Set();

    orders.forEach((order) => {
      if (!order.shopOrders) return;

      order.shopOrders.forEach((shopOrder) => {
        const isAssigned =
          shopOrder.assignedDeliveryBoy?.toString() === userId.toString() ||
          (typeof shopOrder.assignedDeliveryBoy === "object" &&
            shopOrder.assignedDeliveryBoy?._id?.toString() === userId.toString());

        if (isAssigned && shopOrder.status === "delivered") {
          if (!processedOrderIds.has(order._id.toString())) {
            const deliveryFee = Number(order.deliveryFee) || 0;
            totalEarnings += deliveryFee;
            processedOrderIds.add(order._id.toString());
          }
        }
      });
    });

    // Calculate total wallet withdrawals and pending withdrawals
    // According to business rules: Wallet = Total Earnings - Completed Payouts - Pending Payouts
    let totalCompletedPayouts = 0; // Only count "paid" status for manual payouts
    let pendingWalletWithdrawals = 0;

    if (user.payouts && Array.isArray(user.payouts)) {
      user.payouts.forEach((payout) => {
        const payoutStatus = payout.status?.toLowerCase() || "";
        const payoutAmount = Number(payout.amount) || 0;
        const source = payout.source || "wallet";
        const payoutType = payout.type || "manual";

        // Only count manual payouts (user-initiated withdrawals), not automatic wallet credits
        if (source === "wallet" && payoutType === "manual") {
          if (payoutStatus === "pending" || payoutStatus === "in_transit") {
            pendingWalletWithdrawals += payoutAmount;
          } else if (payoutStatus === "paid") {
            totalCompletedPayouts += payoutAmount;
          }
        }
      });
    }

    const netWalletBalance = Math.max(0, totalEarnings - totalCompletedPayouts);
    const availableWalletBalance = Math.max(
      0,
      netWalletBalance - pendingWalletWithdrawals,
    );

    // Validate amount doesn't exceed available wallet balance
    if (amount > availableWalletBalance) {
      return res.status(400).json({
        message: `Insufficient wallet balance. Available: ฿${availableWalletBalance.toFixed(2)}`,
      });
    }

    // Check for existing pending payout requests from wallet
    const existingPendingRequest = await PayoutRequest.findOne({
      user: userId,
      requesterType: "deliverer",
      status: "pending",
    });

    if (existingPendingRequest) {
      return res.status(400).json({
        message: "You already have a pending payout request. Please wait for it to be processed.",
      });
    }

    // Create payout record in user
    const payoutId = `payout_${Date.now()}_${userId}`;
    user.payouts.push({
      payoutId,
      amount,
      currency: "thb",
      status: "pending",
      method: "standard",
      type: "manual",
      source: "wallet",
      createdAt: new Date(),
    });

    await user.save();

    // Create payout request
    const bankInfo = `${user.ePaymentAccount.bank} • ${user.ePaymentAccount.accountNumber}`;
    const payoutReq = await PayoutRequest.create({
      user: userId,
      requesterType: "deliverer",
      amount,
      currency: "thb",
      method: "standard",
      bankInfo,
      status: "pending",
      transactionId: payoutId,
    });

    // Notify admins
    try {
      const io = req.app.get("io");
      const admins = await User.find({ role: "admin" }).select("_id");
      if (Array.isArray(admins) && admins.length > 0) {
        await Promise.all(
          admins.map((a) =>
            createNotification({
              recipient: a._id,
              title: "New Payout Request",
              message: `Delivery payout pending: ${user.fullName} • ฿${Number(amount || 0).toFixed(2)}`,
              type: "payout",
              relatedId: payoutReq?._id,
              relatedModel: "PayoutRequest",
            }),
          ),
        );
      }
      if (io) {
        io.to("admins").emit("notification", {
          type: "payout",
          payoutRequestId: payoutReq?._id?.toString(),
        });
      }
    } catch (e) {
      // ignore notification errors
    }

    res.status(200).json({
      message: "Payout request submitted successfully",
      payoutRequest: payoutReq,
      walletBalance: availableWalletBalance - amount, // Remaining balance after request
    });
  } catch (error) {
    res.status(500).json({
      message: `Request payout error: ${error.message}`,
    });
  }
};

// Get Transactions
export const getTransactions = async (req, res) => {
  try {
    const userId = req.userId;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Return payouts as transactions for now
    res.status(200).json({ transactions: user.payouts.reverse() });
  } catch (error) {
    res
      .status(500)
      .json({ message: `Get transactions error: ${error.message}` });
  }
};

// Add Saved Address
export const addSavedAddress = async (req, res) => {
  try {
    const {
      label,
      address,
      location,
      contactName,
      contactNumber,
      note,
      isDefault,
    } = req.body;
    const userId = req.userId;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (isDefault) {
      user.savedAddresses.forEach((addr) => (addr.isDefault = false));
    }

    user.savedAddresses.push({
      label,
      address,
      location,
      contactName,
      contactNumber,
      note,
      isDefault: isDefault || false,
    });

    await user.save();
    res.status(200).json(user.savedAddresses);
  } catch (error) {
    res.status(500).json({ message: `Add address error: ${error.message}` });
  }
};

// Update Saved Address
export const updateSavedAddress = async (req, res) => {
  try {
    const { addressId } = req.params;
    const {
      label,
      address,
      location,
      contactName,
      contactNumber,
      note,
      isDefault,
    } = req.body;
    const userId = req.userId;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (isDefault) {
      user.savedAddresses.forEach((addr) => (addr.isDefault = false));
    }

    const addrIndex = user.savedAddresses.findIndex(
      (addr) => addr._id.toString() === addressId,
    );
    if (addrIndex === -1) {
      return res.status(404).json({ message: "Address not found" });
    }

    user.savedAddresses[addrIndex] = {
      ...user.savedAddresses[addrIndex].toObject(),
      label,
      address,
      location,
      contactName,
      contactNumber,
      note,
      isDefault: isDefault || false,
    };

    await user.save();
    res.status(200).json(user.savedAddresses);
  } catch (error) {
    res.status(500).json({ message: `Update address error: ${error.message}` });
  }
};

// Delete Saved Address
export const deleteSavedAddress = async (req, res) => {
  try {
    const { addressId } = req.params;
    const userId = req.userId;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.savedAddresses = user.savedAddresses.filter(
      (addr) => addr._id.toString() !== addressId,
    );
    await user.save();
    res.status(200).json(user.savedAddresses);
  } catch (error) {
    res.status(500).json({ message: `Delete address error: ${error.message}` });
  }
};

// Add Saved Card
export const addSavedCard = async (req, res) => {
  try {
    const {
      cardType,
      last4,
      cardNumber,
      expiry,
      cvv,
      cardholderName,
      nickname,
      isDefault,
    } = req.body;
    const userId = req.userId;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (isDefault) {
      user.savedCards.forEach((card) => (card.isDefault = false));
    }

    user.savedCards.push({
      cardType,
      last4,
      cardNumber,
      expiry,
      cvv,
      cardholderName,
      nickname,
      isDefault: isDefault || false,
    });

    await user.save();
    res.status(200).json(user.savedCards);
  } catch (error) {
    res.status(500).json({ message: `Add card error: ${error.message}` });
  }
};

// Delete Saved Card
export const deleteSavedCard = async (req, res) => {
  try {
    const { cardId } = req.params;
    const userId = req.userId;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.savedCards = user.savedCards.filter(
      (card) => card._id.toString() !== cardId,
    );
    await user.save();
    res.status(200).json(user.savedCards);
  } catch (error) {
    res.status(500).json({ message: `Delete card error: ${error.message}` });
  }
};

// Set Default Card
export const setDefaultCard = async (req, res) => {
  try {
    const { cardId } = req.params;
    const userId = req.userId;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.savedCards.forEach((card) => {
      card.isDefault = card._id.toString() === cardId;
    });

    user.defaultPaymentMethod = "card";

    await user.save();
    res.status(200).json(user.savedCards);
  } catch (error) {
    res
      .status(500)
      .json({ message: `Set default card error: ${error.message}` });
  }
};

// Set Default Payment Method
export const setDefaultPaymentMethod = async (req, res) => {
  try {
    const { method } = req.body;
    const userId = req.userId;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!["card", "promptpay", "cod"].includes(method)) {
      return res.status(400).json({ message: "Invalid payment method" });
    }

    user.defaultPaymentMethod = method;
    await user.save();

    res.status(200).json({
      message: "Default payment method updated",
      defaultPaymentMethod: user.defaultPaymentMethod,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Set default payment method error: ${error.message}` });
  }
};

// Save Push Subscription
export const savePushSubscription = async (req, res) => {
  try {
    const { subscription } = req.body;
    const userId = req.userId;

    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ message: "Invalid subscription object" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.pushSubscription = subscription;
    await user.save();

    console.log(`Push subscription saved for user ${userId}`);

    res.status(200).json({ message: "Push subscription saved successfully" });
  } catch (error) {
    console.error("Error saving push subscription:", error);
    res.status(500).json({ message: "Failed to save subscription" });
  }
};

// Send Test Notification
export const sendTestNotification = async (req, res) => {
  try {
    if (!vapidPublicKey || !vapidPrivateKey) {
      return res.status(500).json({
        message:
          "Push notifications are not configured on the server (missing VAPID keys).",
      });
    }

    const userId = req.userId;
    const user = await User.findById(userId);

    if (!user || !user.pushSubscription || !user.pushSubscription.endpoint) {
      return res
        .status(404)
        .json({ message: "User or subscription not found" });
    }

    const payload = JSON.stringify({
      title: "Test Notification",
      body: "This is a test notification from Vingo!",
      icon: "/scooter.png", // Ensure this path is correct for frontend
    });

    try {
      await webpush.sendNotification(user.pushSubscription, payload);
      res.status(200).json({ message: "Notification sent successfully" });
    } catch (err) {
      console.error("Error sending notification:", err);
      // If 410 or 404, the subscription is expired/invalid
      if (err.statusCode === 410 || err.statusCode === 404) {
        user.pushSubscription = undefined;
        await user.save();
        return res
          .status(400)
          .json({ message: "Subscription expired, please resubscribe" });
      }
      res.status(500).json({ message: "Failed to send notification" });
    }
  } catch (error) {
    console.error("Error in test notification:", error);
    res.status(500).json({ message: "Server error" });
  }
};
