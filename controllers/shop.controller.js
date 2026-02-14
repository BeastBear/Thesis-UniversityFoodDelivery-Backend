import Shop from "../models/shop.model.js";
import Order from "../models/order.model.js";
import User from "../models/user.model.js";
import PayoutRequest from "../models/payoutRequest.model.js";
import SystemSettings from "../models/systemSettings.model.js";
import uploadOnCloudinary from "../utils/cloudinary.js";
import { clearExpiredClosures } from "../utils/shopClosure.js";
import stripe from "../config/stripe.js";
import { createNotification } from "./notification.controller.js";

export const getShopById = async (req, res) => {
  try {
    const { shopId } = req.params;
    const shop = await Shop.findById(shopId);
    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    if (shop.isApproved !== true || shop.temporaryClosure?.isClosed === true) {
      const user = await User.findById(req.userId).select("role");
      const isPrivileged =
        user?.role === "admin" || shop.owner?.toString() === req.userId;

      if (!isPrivileged) {
        return res.status(403).json({
          message:
            shop.isApproved !== true
              ? "Restaurant is not available."
              : "Restaurant is temporarily closed.",
        });
      }
    }

    // Clear expired closures before returning
    await clearExpiredClosures(shop);
    await shop.populate("category");
    return res.status(200).json(shop);
  } catch (error) {
    return res.status(500).json({ message: `get shop error ${error}` });
  }
};

export const createEditShop = async (req, res) => {
  try {
    const {
      name,
      cafeteria,
      category,
      latitude,
      longitude,
      address,
      note,
      shopNumber,
      businessHours,
    } = req.body;
    let image;
    if (req.file) {
      image = await uploadOnCloudinary(req.file.path);
    }

    // Parse businessHours if it's a string
    let parsedBusinessHours = businessHours;
    if (typeof businessHours === "string") {
      try {
        parsedBusinessHours = JSON.parse(businessHours);
      } catch (e) {
        parsedBusinessHours = [];
      }
    }

    let shop = await Shop.findOne({ owner: req.userId });
    if (!shop) {
      shop = await Shop.create({
        name,
        cafeteria,
        category: category || undefined,
        image,
        owner: req.userId,
        address: address || "",
        note: note || "",
        shopNumber: shopNumber || "",
        businessHours: parsedBusinessHours || [],
        location:
          latitude && longitude
            ? {
                latitude: parseFloat(latitude),
                longitude: parseFloat(longitude),
              }
            : undefined,
      });
    } else {
      const updateData = {
        name,
        cafeteria,
        owner: req.userId,
      };
      if (image) updateData.image = image;
      if (category !== undefined) updateData.category = category || null;
      if (address !== undefined) updateData.address = address;
      if (note !== undefined) updateData.note = note;
      if (shopNumber !== undefined) updateData.shopNumber = shopNumber;
      if (parsedBusinessHours !== undefined)
        updateData.businessHours = parsedBusinessHours;
      if (latitude && longitude) {
        updateData.location = {
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
        };
      }

      shop = await Shop.findByIdAndUpdate(shop._id, updateData, { new: true });
    }

    await shop.populate("owner items category");
    return res.status(201).json(shop);
  } catch (error) {
    return res.status(500).json({ message: `create shop error ${error}` });
  }
};

export const getMyShop = async (req, res) => {
  try {
    let shop = await Shop.findOne({ owner: req.userId })
      .populate("owner")
      .populate("category")
      .populate({
        path: "items",
        options: { sort: { updatedAt: -1 } },
      });

    if (!shop) {
      const user = await User.findById(req.userId).select(
        "role ownerVerification",
      );

      if (
        user?.role === "owner" &&
        user?.ownerVerification?.status === "verified"
      ) {
        const restaurant = user.ownerVerification?.restaurant || {};
        const bank = user.ownerVerification?.bank || {};

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

        await Shop.create({
          owner: req.userId,
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

        shop = await Shop.findOne({ owner: req.userId })
          .populate("owner")
          .populate("category")
          .populate({
            path: "items",
            options: { sort: { updatedAt: -1 } },
          });
      }
    }

    if (!shop) {
      return res.status(200).json(null);
    }
    
    // Clear expired closures before returning
    await clearExpiredClosures(shop);
    
    // Calculate wallet balance
    const settings = await SystemSettings.findOne().select("commissionPercentage").lean();
    const commissionPercentage = Number(settings?.commissionPercentage ?? 0);
    const gpRate = Number.isFinite(commissionPercentage)
      ? Math.min(Math.max(commissionPercentage, 0), 100) / 100
      : 0;

    // Get all delivered orders for this shop
    const deliveredOrders = await Order.find({
      "shopOrders.shop": shop._id,
      "shopOrders.status": "delivered",
    });

    // Calculate total shop earnings from all delivered orders
    let totalShopEarnings = 0;
    deliveredOrders.forEach((order) => {
      const shopOrder = order.shopOrders.find(
        (so) => so.shop?.toString() === shop._id.toString(),
      );
      if (shopOrder && shopOrder.subtotal) {
        const foodPrice = Number(shopOrder.subtotal) || 0;
        const platformIncome = Math.round(foodPrice * gpRate * 100) / 100;
        const shopEarnings = Math.round((foodPrice - platformIncome) * 100) / 100;
        totalShopEarnings += shopEarnings;
      }
    });

    // Calculate total completed payouts (paid status only)
    // Exclude old test payouts from previous Stripe sandbox
    // Only count payouts created after a certain date (e.g., when new sandbox was set up)
    // Set this to the date when you switched to the new Stripe sandbox
    // Example: new Date('2024-12-01') for December 1, 2024
    // Set to null to include all payouts regardless of date
    const newSandboxStartDate = new Date('2024-12-01'); // TODO: Update this to your actual new sandbox start date
    let totalCompletedPayouts = 0;
    if (shop.payouts && Array.isArray(shop.payouts)) {
      shop.payouts.forEach((payout) => {
        if (payout.status === "paid") {
          // If newSandboxStartDate is null, include all payouts
          if (newSandboxStartDate === null) {
            totalCompletedPayouts += Number(payout.amount) || 0;
          } else {
            const payoutDate = payout.createdAt ? new Date(payout.createdAt) : new Date(0);
            // Only count payouts created after the new sandbox start date
            if (payoutDate >= newSandboxStartDate) {
              totalCompletedPayouts += Number(payout.amount) || 0;
            }
          }
        }
      });
    }

    // Calculate pending payouts (also exclude old test data)
    let pendingPayouts = 0;
    if (shop.payouts && Array.isArray(shop.payouts)) {
      shop.payouts.forEach((payout) => {
        if (payout.status === "pending" || payout.status === "in_transit") {
          // If newSandboxStartDate is null, include all payouts
          if (newSandboxStartDate === null) {
            pendingPayouts += Number(payout.amount) || 0;
          } else {
            const payoutDate = payout.createdAt ? new Date(payout.createdAt) : new Date(0);
            // Only count payouts created after the new sandbox start date
            if (payoutDate >= newSandboxStartDate) {
              pendingPayouts += Number(payout.amount) || 0;
            }
          }
        }
      });
    }

    const netWalletBalance = Math.max(0, totalShopEarnings - totalCompletedPayouts);
    const availableWalletBalance = Math.max(0, netWalletBalance - pendingPayouts);

    // Add wallet balance to shop object
    const shopData = shop.toObject();
    shopData.walletBalance = {
      totalShopEarnings,
      totalCompletedPayouts,
      pendingPayouts,
      netWalletBalance,
      availableWalletBalance,
    };

    return res.status(200).json(shopData);
  } catch (error) {
    return res.status(500).json({ message: `get my shop error ${error}` });
  }
};

export const getShopByCity = async (req, res) => {
  try {
    const { city } = req.params;

    const shops = await Shop.find({
      cafeteria: city,
      isApproved: true,
    }).populate("items category");
    if (!shops) {
      return res.status(400).json({ message: "shops not found" });
    }
    // Clear expired closures for all shops before returning
    for (const shop of shops) {
      await clearExpiredClosures(shop);
    }
    return res.status(200).json(shops);
  } catch (error) {
    return res.status(500).json({ message: `get shop by city error ${error}` });
  }
};

export const getAllShops = async (req, res) => {
  try {
    const shops = await Shop.find({ isApproved: true }).populate("items category");
    if (!shops) {
      return res.status(400).json({ message: "shops not found" });
    }
    // Clear expired closures for all shops before returning
    for (const shop of shops) {
      await clearExpiredClosures(shop);
    }
    return res.status(200).json(shops);
  } catch (error) {
    return res.status(500).json({ message: `get all shops error ${error}` });
  }
};

export const temporaryClose = async (req, res) => {
  try {
    const { shopId, reopenTime } = req.body;

    if (!shopId || !reopenTime) {
      return res
        .status(400)
        .json({ message: "Shop ID and reopen time are required" });
    }

    const shop = await Shop.findById(shopId);
    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    // Verify ownership
    if (shop.owner.toString() !== req.userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Calculate closedUntil date based on reopenTime
    const now = new Date();
    const [hour, minute] = reopenTime.split(":").map(Number);
    const reopenDate = new Date(now);
    reopenDate.setHours(hour, minute, 0, 0);

    // If the reopen time is earlier than current time, assume it's for tomorrow
    if (reopenDate <= now) {
      reopenDate.setDate(reopenDate.getDate() + 1);
    }

    shop.temporaryClosure = {
      isClosed: true,
      reopenTime: reopenTime,
      closedUntil: reopenDate,
    };

    await shop.save();

    return res.status(200).json({
      message: "Shop temporarily closed",
      shop: {
        _id: shop._id,
        temporaryClosure: shop.temporaryClosure,
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Temporary close error: ${error.message}` });
  }
};

export const closeToday = async (req, res) => {
  try {
    const { shopId } = req.body;

    if (!shopId) {
      return res.status(400).json({ message: "Shop ID is required" });
    }

    const shop = await Shop.findById(shopId);
    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    // Verify ownership
    if (shop.owner.toString() !== req.userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Close shop until end of today
    const now = new Date();
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    shop.temporaryClosure = {
      isClosed: true,
      reopenTime: null,
      closedUntil: endOfToday,
    };

    await shop.save();

    return res.status(200).json({
      message: "Shop closed for today",
      shop: {
        _id: shop._id,
        temporaryClosure: shop.temporaryClosure,
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Close today error: ${error.message}` });
  }
};

export const closeMultipleDays = async (req, res) => {
  try {
    const { shopId, days } = req.body;

    if (!shopId || !days || days < 1) {
      return res.status(400).json({
        message: "Shop ID and number of days (minimum 1) are required",
      });
    }

    const shop = await Shop.findById(shopId);
    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    // Verify ownership
    if (shop.owner.toString() !== req.userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Close shop for specified number of days
    const now = new Date();
    const closedUntil = new Date(now);
    closedUntil.setDate(closedUntil.getDate() + days);
    closedUntil.setHours(23, 59, 59, 999);

    shop.temporaryClosure = {
      isClosed: true,
      reopenTime: null,
      closedUntil: closedUntil,
    };

    await shop.save();

    return res.status(200).json({
      message: `Shop closed for ${days} day(s)`,
      shop: {
        _id: shop._id,
        temporaryClosure: shop.temporaryClosure,
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Close multiple days error: ${error.message}` });
  }
};

export const addSpecialHoliday = async (req, res) => {
  try {
    const { shopId, startDate, endDate } = req.body;

    if (!shopId || !startDate || !endDate) {
      return res
        .status(400)
        .json({ message: "Shop ID, start date, and end date are required" });
    }

    const shop = await Shop.findById(shopId);
    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    // Verify ownership
    if (shop.owner.toString() !== req.userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    if (end < start) {
      return res
        .status(400)
        .json({ message: "End date must be after start date" });
    }

    const now = new Date();
    now.setHours(0, 0, 0, 0); // Reset to start of day for comparison
    const startDay = new Date(start);
    startDay.setHours(0, 0, 0, 0);
    const endDay = new Date(end);
    endDay.setHours(23, 59, 59, 999);

    // Add special holiday
    shop.specialHolidays.push({
      startDate: start,
      endDate: end,
    });

    // Only close shop if the holiday period is currently active (today is within the holiday range)
    if (now >= startDay && now <= endDay) {
      // Holiday is currently active, close shop until end of holiday
      shop.temporaryClosure = {
        isClosed: true,
        reopenTime: null,
        closedUntil: end,
      };
    }
    // If holiday is in the future, don't close yet - it will be checked when the date arrives

    await shop.save();

    return res.status(200).json({
      message: "Special holiday added",
      shop: {
        _id: shop._id,
        specialHolidays: shop.specialHolidays,
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Add special holiday error: ${error.message}` });
  }
};

export const updateEPaymentAccount = async (req, res) => {
  try {
    const { accountName, bank, branch, accountNumber, applicationId } =
      req.body;

    const shop = await Shop.findOne({ owner: req.userId });
    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    // Verify ownership
    if (shop.owner.toString() !== req.userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Update ePaymentAccount
    shop.ePaymentAccount = {
      accountName: accountName || "",
      bank: bank || "",
      branch: branch || "",
      accountNumber: accountNumber || "",
      applicationId: applicationId || "",
    };

    // If bank account details are provided, try to add it to Stripe
    if (accountNumber && bank) {
      try {
        const cleanAccountNumber = accountNumber.replace(/[-\s]/g, "");

        // Try to add bank account to Stripe
        // For platform accounts, we need to get the account ID first
        try {
          // Get the platform account information
          const account = await stripe.accounts.retrieve();

          // Create external account (bank account) on the platform account
          const externalAccount = await stripe.accounts.createExternalAccount(
            account.id,
            {
              external_account: {
                object: "bank_account",
                country: "TH",
                currency: "thb",
                account_holder_name: accountName || shop.name,
                account_holder_type: "individual",
                account_number: cleanAccountNumber,
              },
              metadata: {
                shopId: shop._id.toString(),
                shopName: shop.name,
                bank: bank,
                branch: branch || "",
                applicationId: applicationId || "",
              },
            },
          );

          // Store the Stripe bank account ID
          shop.stripeBankAccountId = externalAccount.id;
          console.log(
            "Bank account added to Stripe successfully:",
            externalAccount.id,
          );
        } catch (stripeError) {
          console.error("Error adding bank account to Stripe:", stripeError);

          // If account retrieval fails, try alternative approach
          if (
            stripeError.code === "resource_missing" ||
            stripeError.message.includes("No such account")
          ) {
            console.log(
              "Could not retrieve account. Bank account may need to be added via Dashboard.",
            );
          }

          // Don't fail the update if Stripe account creation fails
          // The bank account details are still saved, user can add manually via Dashboard
          shop.stripeBankAccountId = null; // Clear if it failed
        }
      } catch (error) {
        console.error("Error processing Stripe bank account:", error);
        // Continue with saving the account details even if Stripe fails
        shop.stripeBankAccountId = null;
      }
    } else {
      // If bank account details are removed, clear the Stripe bank account ID
      shop.stripeBankAccountId = null;
    }

    await shop.save();
    await shop.populate("owner items");

    return res.status(200).json({
      message:
        "E-Payment account updated" +
        (shop.stripeBankAccountId
          ? " and bank account added to Stripe"
          : ". Note: Please add bank account to Stripe Dashboard for payouts."),
      shop: shop,
      stripeBankAccountAdded: !!shop.stripeBankAccountId,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Update e-payment account error: ${error.message}` });
  }
};

export const withdrawToBank = async (req, res) => {
  try {
    const { amount, method = "standard" } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: "Invalid withdrawal amount" });
    }

    const shop = await Shop.findOne({ owner: req.userId });
    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    // Verify ownership
    if (shop.owner.toString() !== req.userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Check if e-payment account is set up
    if (!shop.ePaymentAccount?.accountNumber || !shop.ePaymentAccount?.bank) {
      return res.status(400).json({
        message:
          "Bank account information is not set up. Please update your E-Payment Account first.",
      });
    }

    // Convert amount to cents (Stripe expects amounts in cents)
    const amountInCents = Math.round(amount * 100);

    try {
      let connectAccountId = shop.stripeConnectAccountId;
      let bankAccountId = shop.stripeBankAccountId;

      // Step 1: Use platform account for payouts (no Connect required)
      // For payouts without Stripe Connect, we use the platform's own account
      // The bank account will be stored and payouts will be made from the platform account

      // Note: To use Stripe Connect (recommended for production):
      // 1. Enable Stripe Connect at https://stripe.com/docs/connect
      // 2. Then uncomment the Connect account creation code below

      // Alternative: Use platform account payouts (current implementation)
      // This approach doesn't require Connect but requires funds in the platform account

      // If you want to use Connect (uncomment when Connect is enabled):
      /*
      if (!connectAccountId) {
        // Ensure owner is populated to get email
        if (!shop.owner.email) {
          await shop.populate("owner");
        }

        // Create a Stripe Connect Express account for the shop owner
        const account = await stripe.accounts.create({
          type: "express",
          country: "TH", // Thailand
          email: shop.owner.email || shop.owner.fullName + "@example.com",
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          metadata: {
            shopId: shop._id.toString(),
            shopName: shop.name,
          },
        });

        connectAccountId = account.id;
        shop.stripeConnectAccountId = connectAccountId;
        await shop.save();
      }
      */

      // Step 2: Create payout using Stripe Payout API
      // Reference: https://docs.stripe.com/api/payouts
      // According to Stripe API docs, we can create payouts with just amount and currency
      // The destination is optional - if omitted, uses default payout destination

      try {
        // Create payout using Stripe Payouts API
        // POST /v1/payouts
        const payout = await stripe.payouts.create({
          amount: amountInCents, // Required: positive integer in cents
          currency: "thb", // Required: three-letter ISO currency code
          method: method === "instant" ? "instant" : "standard", // Optional: "standard" or "instant"
          statement_descriptor: `Withdrawal for ${shop.name}`, // Optional: up to 22 characters
          description: `Withdrawal for ${shop.name}`, // Optional: arbitrary string
          metadata: {
            shopId: shop._id.toString(),
            shopName: shop.name,
            accountName: shop.ePaymentAccount.accountName,
            accountNumber: shop.ePaymentAccount.accountNumber,
            bank: shop.ePaymentAccount.bank,
            branch: shop.ePaymentAccount.branch || "",
            applicationId: shop.ePaymentAccount.applicationId || "",
            withdrawalType: "wallet_withdrawal",
          },
          // destination: optional - if omitted, uses default payout destination
          // We can specify destination if we have a stored bank account ID
          ...(bankAccountId && { destination: bankAccountId }),
        });

        console.log("Payout created successfully:", {
          payoutId: payout.id,
          amount: payout.amount,
          currency: payout.currency,
          status: payout.status,
          arrivalDate: payout.arrival_date,
        });

        // Save payout to shop's payout history
        shop.payouts.push({
          payoutId: payout.id,
          amount: amount, // Amount in THB (not cents)
          currency: payout.currency,
          status: payout.status,
          method: payout.method,
          type: "manual", // This is a manual withdrawal initiated by the owner
          arrivalDate: payout.arrival_date
            ? new Date(payout.arrival_date * 1000)
            : null,
        });

        const bankInfo = `${shop.ePaymentAccount.bank} • ${shop.ePaymentAccount.accountNumber}`;
        const payoutReq = await PayoutRequest.create({
          user: shop.owner,
          shop: shop._id,
          requesterType: "shop",
          amount,
          currency: payout.currency,
          method: payout.method,
          bankInfo,
          status: "pending",
          transactionId: payout.id,
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
                  message: `Shop payout pending: ${shop.name} • ฿${Number(amount || 0).toFixed(2)}`,
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

        await shop.save();
        await shop.populate("owner items");

        return res.status(200).json({
          message: "Withdrawal initiated successfully",
          payoutId: payout.id,
          amount: amount,
          currency: payout.currency.toUpperCase(),
          status: payout.status,
          arrivalDate: payout.arrival_date,
          method: payout.method,
          accountNumber: shop.ePaymentAccount.accountNumber,
          bank: shop.ePaymentAccount.bank,
          shop: shop, // Return updated shop data with payouts
        });
      } catch (payoutError) {
        console.error("Error creating payout:", payoutError);

        // Handle specific Stripe errors
        if (
          payoutError.message.includes("external accounts") ||
          payoutError.message.includes("no external accounts")
        ) {
          return res.status(400).json({
            message:
              "No THB bank account found in your Stripe account. Please add a Thai Baht (THB) bank account first via Stripe Dashboard → Settings → Bank accounts and selling.",
            stripeError: payoutError.message,
            errorCode: payoutError.code,
            helpUrl: "https://dashboard.stripe.com/settings/payouts",
            instructions: [
              "1. Go to Stripe Dashboard → Settings → Bank accounts and selling",
              "2. Click 'Add bank account'",
              "3. Select Thailand (TH) as country and THB as currency",
              "4. Enter your bank account details",
              "5. Save and verify the account",
              "6. Try the withdrawal again",
            ],
          });
        }

        if (payoutError.code === "account_invalid") {
          return res.status(400).json({
            message:
              "Bank account verification required. Please ensure your bank account details are correct and verified.",
            stripeError: payoutError.message,
            errorCode: payoutError.code,
          });
        }

        // For other errors, return error with helpful message
        return res.status(500).json({
          message: `Withdrawal failed: ${payoutError.message}`,
          errorCode: payoutError.code,
          errorType: payoutError.type,
          note: "Please ensure your Stripe account has sufficient balance and a THB bank account is added.",
        });
      }

      /* 
      // Alternative: Use stored external account (for Connect accounts)
      // This code runs if you enable Connect accounts above
      if (!bankAccountId) {
        try {
          const cleanAccountNumber = shop.ePaymentAccount.accountNumber.replace(/[-\s]/g, "");

          const externalAccount = await stripe.accounts.createExternalAccount(
            connectAccountId,
            {
              external_account: {
                object: "bank_account",
                country: "TH",
                currency: "thb",
                account_holder_name: shop.ePaymentAccount.accountName || shop.name,
                account_holder_type: "individual",
                account_number: cleanAccountNumber,
                metadata: {
                  shopId: shop._id.toString(),
                  shopName: shop.name,
                  bank: shop.ePaymentAccount.bank,
                  branch: shop.ePaymentAccount.branch || "",
                  applicationId: shop.ePaymentAccount.applicationId || "",
                },
              },
            }
          );

          bankAccountId = externalAccount.id;
          shop.stripeBankAccountId = bankAccountId;
          await shop.save();

          console.log("Bank account created successfully:", bankAccountId);
        } catch (bankAccountError) {
          console.error("Error creating bank account:", bankAccountError);
          return res.status(400).json({
            message: "Bank account verification required. Please complete Stripe Connect onboarding first.",
            stripeError: bankAccountError.message,
            errorCode: bankAccountError.code,
            connectAccountId: connectAccountId,
          });
        }
      }
      */

      // Note: The payout creation is now in Step 2 above
      // Step 3 (balance check) is optional and can be added if needed:
      /*
      try {
        const balance = await stripe.balance.retrieve();
        const availableBalance = balance.available.find((b) => b.currency === "thb");
        
        if (availableBalance && amountInCents > availableBalance.amount) {
          return res.status(400).json({
            message: `Insufficient balance. Available: ฿${(availableBalance.amount / 100).toFixed(2)}`,
          });
        }
      } catch (balanceError) {
        console.warn("Could not retrieve balance:", balanceError.message);
        // Continue with payout even if balance check fails
      }
      */
    } catch (stripeError) {
      console.error("Stripe withdrawal error:", stripeError);
      return res.status(500).json({
        message: `Withdrawal failed: ${stripeError.message}`,
        errorCode: stripeError.code,
        errorType: stripeError.type,
      });
    }
  } catch (error) {
    return res.status(500).json({
      message: `Withdraw error: ${error.message}`,
    });
  }
};

// Request Payout from Wallet Balance (for shops)
export const requestPayoutFromWallet = async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: "Invalid payout amount" });
    }

    const shop = await Shop.findOne({ owner: req.userId });
    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    // Verify ownership
    if (shop.owner.toString() !== req.userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Check if e-payment account is set up
    if (!shop.ePaymentAccount?.accountNumber || !shop.ePaymentAccount?.bank) {
      return res.status(400).json({
        message:
          "Bank account information is not set up. Please update your E-Payment Account first.",
      });
    }

    // Calculate wallet balance according to business rules:
    // Wallet Balance = Sum of all Shop Earnings (from delivered orders) - Sum of all Completed Payouts
    // Shop Earnings = foodPrice - Platform Income = foodPrice * (1 - gpRate)
    
    // Get commission rate
    const settings = await SystemSettings.findOne().select("commissionPercentage").lean();
    const commissionPercentage = Number(settings?.commissionPercentage ?? 0);
    const gpRate = Number.isFinite(commissionPercentage)
      ? Math.min(Math.max(commissionPercentage, 0), 100) / 100
      : 0;

    // Get all delivered orders for this shop
    const deliveredOrders = await Order.find({
      "shopOrders.shop": shop._id,
      "shopOrders.status": "delivered",
    });

    // Calculate total shop earnings from all delivered orders
    let totalShopEarnings = 0;
    deliveredOrders.forEach((order) => {
      const shopOrder = order.shopOrders.find(
        (so) => so.shop?.toString() === shop._id.toString(),
      );
      if (shopOrder && shopOrder.subtotal) {
        const foodPrice = Number(shopOrder.subtotal) || 0;
        const platformIncome = Math.round(foodPrice * gpRate * 100) / 100;
        const shopEarnings = Math.round((foodPrice - platformIncome) * 100) / 100;
        totalShopEarnings += shopEarnings;
      }
    });

    // Calculate total completed payouts (paid status only)
    // Exclude old test payouts from previous Stripe sandbox
    // Only count payouts created after a certain date (e.g., when new sandbox was set up)
    // Set this to the date when you switched to the new Stripe sandbox
    // Example: new Date('2024-12-01') for December 1, 2024
    // Set to null to include all payouts regardless of date
    const newSandboxStartDate = new Date('2024-12-01'); // TODO: Update this to your actual new sandbox start date
    let totalCompletedPayouts = 0;
    if (shop.payouts && Array.isArray(shop.payouts)) {
      shop.payouts.forEach((payout) => {
        if (payout.status === "paid") {
          // If newSandboxStartDate is null, include all payouts
          if (newSandboxStartDate === null) {
            totalCompletedPayouts += Number(payout.amount) || 0;
          } else {
            const payoutDate = payout.createdAt ? new Date(payout.createdAt) : new Date(0);
            // Only count payouts created after the new sandbox start date
            if (payoutDate >= newSandboxStartDate) {
              totalCompletedPayouts += Number(payout.amount) || 0;
            }
          }
        }
      });
    }

    // Calculate available wallet balance (excluding pending payouts)
    // Also exclude old test data
    let pendingPayouts = 0;
    if (shop.payouts && Array.isArray(shop.payouts)) {
      shop.payouts.forEach((payout) => {
        if (payout.status === "pending" || payout.status === "in_transit") {
          // If newSandboxStartDate is null, include all payouts
          if (newSandboxStartDate === null) {
            pendingPayouts += Number(payout.amount) || 0;
          } else {
            const payoutDate = payout.createdAt ? new Date(payout.createdAt) : new Date(0);
            // Only count payouts created after the new sandbox start date
            if (payoutDate >= newSandboxStartDate) {
              pendingPayouts += Number(payout.amount) || 0;
            }
          }
        }
      });
    }

    const netWalletBalance = Math.max(0, totalShopEarnings - totalCompletedPayouts);
    const availableWalletBalance = Math.max(0, netWalletBalance - pendingPayouts);

    // Validate amount doesn't exceed available wallet balance
    if (amount > availableWalletBalance) {
      return res.status(400).json({
        message: `Insufficient wallet balance. Available: ฿${availableWalletBalance.toFixed(2)}`,
      });
    }

    // Check for existing pending payout requests
    const existingPendingRequest = await PayoutRequest.findOne({
      shop: shop._id,
      status: "pending",
    });

    if (existingPendingRequest) {
      return res.status(400).json({
        message: "You already have a pending payout request. Please wait for it to be processed.",
      });
    }

    // Create payout record in shop
    const payoutId = `payout_${Date.now()}_${shop._id}`;
    shop.payouts.push({
      payoutId,
      amount,
      currency: "thb",
      status: "pending",
      method: "standard",
      type: "manual",
      createdAt: new Date(),
    });

    await shop.save();

    // Create payout request
    const bankInfo = `${shop.ePaymentAccount.bank} • ${shop.ePaymentAccount.accountNumber}`;
    const payoutReq = await PayoutRequest.create({
      user: shop.owner,
      shop: shop._id,
      requesterType: "shop",
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
              message: `Shop payout pending: ${shop.name} • ฿${Number(amount || 0).toFixed(2)}`,
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

// Get all transactions (payments and payouts) for the shop
export const getTransactions = async (req, res) => {
  try {
    const shop = await Shop.findOne({ owner: req.userId });

    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    const transactions = [];

    // Convert shop to plain object to ensure subdocuments are properly serialized
    const shopObj = shop.toObject
      ? shop.toObject()
      : JSON.parse(JSON.stringify(shop));

    // Get payments from database
    const dbPaymentMap = new Map();
    if (shopObj.payments && Array.isArray(shopObj.payments)) {
      shopObj.payments.forEach((payment) => {
        dbPaymentMap.set(payment.chargeId, {
          ...payment,
          transactionType: "payment",
        });
      });
    }

    // Also fetch charges directly from Stripe to catch any payments
    // that might not have been saved to the database (due to webhook matching issues)
    try {
      // Get orders for this shop to find payment intents
      const shopOrders = await Order.find({
        "shopOrders.shop": shop._id,
        paymentMethod: "online",
        payment: true,
      })
        .sort({ createdAt: -1 })
        .limit(100);

      // Extract payment intent IDs from orders
      const paymentIntentIds = shopOrders
        .map((order) => order.stripePaymentId)
        .filter((id) => id);

      // Fetch charges from Stripe for these payment intents
      if (paymentIntentIds.length > 0) {
        const stripeCharges = await stripe.charges.list({
          limit: 100,
        });

        // Match charges to this shop's orders
        for (const charge of stripeCharges.data) {
          const chargeId = charge.id;

          // Skip if already in database
          if (dbPaymentMap.has(chargeId)) {
            continue;
          }

          // Check if this charge's payment intent matches any of our shop's orders
          if (
            charge.payment_intent &&
            paymentIntentIds.includes(charge.payment_intent)
          ) {
            // Find the order that matches this payment intent
            const matchingOrder = shopOrders.find(
              (order) => order.stripePaymentId === charge.payment_intent,
            );

            if (matchingOrder) {
              // Add to transactions and also save to database for future reference
              const paymentData = {
                chargeId: chargeId,
                paymentIntentId: charge.payment_intent || null,
                orderId: matchingOrder._id,
                amount: charge.amount / 100, // Convert from cents to THB
                currency: charge.currency,
                status: charge.status === "succeeded" ? "succeeded" : "pending",
                receiptUrl: charge.receipt_url || null,
                createdAt: new Date(charge.created * 1000),
                transactionType: "payment",
              };

              dbPaymentMap.set(chargeId, paymentData);

              // Save to database if it doesn't exist (silent fail if error)
              try {
                const existingPayment = shop.payments?.find(
                  (p) => p.chargeId === chargeId,
                );
                if (!existingPayment) {
                  if (!shop.payments) {
                    shop.payments = [];
                  }
                  shop.payments.push({
                    chargeId: paymentData.chargeId,
                    paymentIntentId: paymentData.paymentIntentId,
                    orderId: paymentData.orderId,
                    amount: paymentData.amount,
                    currency: paymentData.currency,
                    status: paymentData.status,
                    receiptUrl: paymentData.receiptUrl,
                    createdAt: paymentData.createdAt,
                  });
                  await shop.save();
                }
              } catch (saveError) {
                console.error(
                  "Error saving Stripe charge to database:",
                  saveError,
                );
                // Continue even if save fails - we still return it in the response
              }
            }
          }
        }
      }
    } catch (stripeError) {
      console.error("Error fetching charges from Stripe:", stripeError);
      // Continue with database payments only if Stripe fetch fails
    }

    // Convert map values to array
    const allPayments = Array.from(dbPaymentMap.values());
    transactions.push(...allPayments);

    // Get payouts from database
    const dbPayoutMap = new Map();
    if (shopObj.payouts && Array.isArray(shopObj.payouts)) {
      shopObj.payouts.forEach((payout) => {
        dbPayoutMap.set(payout.payoutId, {
          ...payout,
          transactionType: "payout",
        });
      });
    }

    // Also fetch payouts directly from Stripe to catch any automatic payouts
    // that might not have been saved to the database (due to webhook matching issues)
    try {
      const stripePayouts = await stripe.payouts.list({
        limit: 100, // Get last 100 payouts
      });

      // Add Stripe payouts that aren't in database
      // Match by destination (bank account) if available
      for (const stripePayout of stripePayouts.data) {
        const payoutId = stripePayout.id;

        // Skip if already in database
        if (dbPayoutMap.has(payoutId)) {
          continue;
        }

        // Try to match this Stripe payout to this shop
        let isForThisShop = false;

        // Check if payout has shopId in metadata
        if (stripePayout.metadata?.shopId === shop._id.toString()) {
          isForThisShop = true;
        }
        // Check if payout destination matches shop's bank account
        else if (
          shop.stripeBankAccountId &&
          stripePayout.destination === shop.stripeBankAccountId
        ) {
          isForThisShop = true;
        }

        if (isForThisShop) {
          // Add to transactions and also save to database for future reference
          const payoutData = {
            payoutId: payoutId,
            amount: stripePayout.amount / 100, // Convert from cents to THB
            currency: stripePayout.currency,
            status: stripePayout.status,
            method: stripePayout.method || "standard",
            type: stripePayout.automatic ? "automatic" : "manual",
            arrivalDate: stripePayout.arrival_date
              ? new Date(stripePayout.arrival_date * 1000)
              : null,
            createdAt: new Date(stripePayout.created * 1000),
            transactionType: "payout",
          };

          dbPayoutMap.set(payoutId, payoutData);

          // Save to database if it doesn't exist (silent fail if error)
          try {
            const existingPayout = shop.payouts?.find(
              (p) => p.payoutId === payoutId,
            );
            if (!existingPayout) {
              if (!shop.payouts) {
                shop.payouts = [];
              }
              shop.payouts.push({
                payoutId: payoutData.payoutId,
                amount: payoutData.amount,
                currency: payoutData.currency,
                status: payoutData.status,
                method: payoutData.method,
                type: payoutData.type,
                arrivalDate: payoutData.arrivalDate,
                createdAt: payoutData.createdAt,
              });
              await shop.save();
            }
          } catch (saveError) {
            console.error("Error saving Stripe payout to database:", saveError);
            // Continue even if save fails - we still return it in the response
          }
        }
      }
    } catch (stripeError) {
      console.error("Error fetching payouts from Stripe:", stripeError);
      // Continue with database payouts only if Stripe fetch fails
    }

    // Convert map values to array
    const allPayouts = Array.from(dbPayoutMap.values());
    transactions.push(...allPayouts);

    // Sort by date (most recent first)
    transactions.sort((a, b) => {
      const dateA = new Date(a.createdAt || 0);
      const dateB = new Date(b.createdAt || 0);
      return dateB - dateA;
    });

    return res.status(200).json({ transactions });
  } catch (error) {
    return res.status(500).json({
      message: `Get transactions error: ${error.message}`,
    });
  }
};

export const removeSpecialHoliday = async (req, res) => {
  try {
    const { shopId, holidayId } = req.body;

    if (!shopId || !holidayId) {
      return res
        .status(400)
        .json({ message: "Shop ID and holiday ID are required" });
    }

    const shop = await Shop.findById(shopId);
    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    // Verify ownership
    if (shop.owner.toString() !== req.userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Get the holiday being removed to check if it's currently active
    const holidayToRemove = shop.specialHolidays.find(
      (holiday) => holiday._id.toString() === holidayId,
    );

    // Remove special holiday
    shop.specialHolidays = shop.specialHolidays.filter(
      (holiday) => holiday._id.toString() !== holidayId,
    );

    // Check if we need to update temporary closure
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    // Check if there are any active special holidays remaining
    const activeHolidays = shop.specialHolidays.filter((holiday) => {
      const startDate = new Date(holiday.startDate);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(holiday.endDate);
      endDate.setHours(23, 59, 59, 999);
      return now >= startDate && now <= endDate;
    });

    // If the removed holiday was active and there are no other active holidays, clear temporary closure
    if (holidayToRemove) {
      const removedStart = new Date(holidayToRemove.startDate);
      removedStart.setHours(0, 0, 0, 0);
      const removedEnd = new Date(holidayToRemove.endDate);
      removedEnd.setHours(23, 59, 59, 999);

      const wasActive = now >= removedStart && now <= removedEnd;

      if (wasActive && activeHolidays.length === 0) {
        // No active holidays remaining, clear temporary closure
        shop.temporaryClosure = {
          isClosed: false,
          reopenTime: null,
          closedUntil: null,
        };
      } else if (activeHolidays.length > 0) {
        // There are other active holidays, update closedUntil to the latest end date
        const latestEndDate = activeHolidays.reduce((latest, holiday) => {
          const endDate = new Date(holiday.endDate);
          endDate.setHours(23, 59, 59, 999);
          return endDate > latest ? endDate : latest;
        }, new Date(0));

        shop.temporaryClosure = {
          isClosed: true,
          reopenTime: null,
          closedUntil: latestEndDate,
        };
      }
    }

    await shop.save();

    return res.status(200).json({
      message: "Special holiday removed",
      shop: {
        _id: shop._id,
        specialHolidays: shop.specialHolidays,
        temporaryClosure: shop.temporaryClosure,
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Remove special holiday error: ${error.message}` });
  }
};
