import Shop from "./../models/shop.model.js";
import Order from "./../models/order.model.js";
import User from "./../models/user.model.js";
import Review from "./../models/review.model.js";
import RiderReview from "./../models/riderReview.model.js";
import mongoose from "mongoose";
import { sendDeliveryOtpMail } from "../utils/mail.js";
import stripe from "../config/stripe.js";
import { createNotification } from "./notification.controller.js";
import * as turf from "@turf/turf";
import SystemSettings from "../models/systemSettings.model.js";
import Zone from "../models/zone.model.js";

// Emit full order payload to the order-specific socket room for live tracking
const emitOrderStatusUpdated = async (io, orderId) => {
  if (!io || !orderId) return;
  try {
    const populatedOrder = await Order.findById(orderId)
      .populate("user", "socketId fullName email mobile")
      .populate("shopOrders.shop", "name location address")
      .populate(
        "shopOrders.assignedDeliveryBoy",
        "fullName profileImage socketId location currentAddress email mobile",
      );

    if (populatedOrder) {
      io.to(orderId.toString()).emit("order_status_updated", populatedOrder);
    }
  } catch (err) {
    console.error("emitOrderStatusUpdated error", err?.message || err);
  }
};

const getGpRate = async () => {
  try {
    const settings = await SystemSettings.findOne()
      .select("commissionPercentage")
      .lean();
    const pct = Number(settings?.commissionPercentage ?? 0);
    if (!Number.isFinite(pct)) return 0;
    const clampedPct = Math.min(Math.max(pct, 0), 100);
    return clampedPct / 100;
  } catch {
    return 0;
  }
};

export const placeOrder = async (req, res) => {
  try {
    const {
      cartItems,
      deliveryAddress,
      paymentMethod,
      deliveryFee,
      paymentFee,
    } = req.body;

    const systemSettings = await SystemSettings.findOne().select(
      "isSystemOpen maintenanceMode deliveryZoneId baseDeliveryFee pricePerKm",
    );
    if (systemSettings) {
      if (
        systemSettings.maintenanceMode === true ||
        systemSettings.isSystemOpen === false
      ) {
        return res.status(503).json({
          message:
            "System is currently closed for maintenance. Please try again later.",
        });
      }
    }

    if (cartItems.length == 0 || !cartItems) {
      return res.status(400).json({ message: "cart is empty" });
    }
    if (
      !deliveryAddress.text ||
      !deliveryAddress.latitude ||
      !deliveryAddress.longitude
    ) {
      return res.status(400).json({ message: "send complete deliveryAddress" });
    }
    if (
      !paymentMethod ||
      !["cod", "online", "promptpay", "card"].includes(paymentMethod)
    ) {
      return res.status(400).json({
        message:
          "payment method must be 'cod', 'online', 'promptpay' or 'card'",
      });
    }

    // Check if delivery address is within the system delivery zone
    try {
      if (systemSettings && systemSettings.deliveryZoneId) {
        const deliveryZone = await Zone.findById(systemSettings.deliveryZoneId);
        if (deliveryZone && deliveryZone.type === "Polygon") {
          // Check if coordinates are valid numbers
          const lat = Number(deliveryAddress.latitude);
          const lng = Number(deliveryAddress.longitude);

          if (!isNaN(lat) && !isNaN(lng)) {
            const pt = turf.point([lng, lat]);
            const polygon = turf.polygon(deliveryZone.coordinates);

            if (!turf.booleanPointInPolygon(pt, polygon)) {
              return res.status(400).json({
                message:
                  "Sorry, your delivery location is outside our service area.",
              });
            }
          }
        }
      }
    } catch (zoneError) {
      console.error("Zone validation error:", zoneError);
    }

    const groupItemsByShop = {};

    cartItems.forEach((item) => {
      const shopId = item.shop;
      if (!groupItemsByShop[shopId]) {
        groupItemsByShop[shopId] = [];
      }
      groupItemsByShop[shopId].push(item);
    });

    // Helper function to check business hours
    const checkBusinessHours = (businessHours) => {
      if (
        !businessHours ||
        !Array.isArray(businessHours) ||
        businessHours.length === 0
      ) {
        return { isOpen: true };
      }

      const now = new Date();
      const dayNames = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ];
      const currentDay = dayNames[now.getDay()];
      const currentTimeInMinutes = now.getHours() * 60 + now.getMinutes();

      const todayHours = businessHours.find((h) => h && h.day === currentDay);
      if (!todayHours) return { isOpen: true };
      if (todayHours.isClosed === true) return { isOpen: false };

      if (
        todayHours.timeSlots &&
        Array.isArray(todayHours.timeSlots) &&
        todayHours.timeSlots.length > 0
      ) {
        for (const slot of todayHours.timeSlots) {
          if (slot.is24Hours) return { isOpen: true };
          if (!slot.openTime || !slot.closeTime) continue;

          const [openHour, openMin] = slot.openTime.split(":").map(Number);
          const [closeHour, closeMin] = slot.closeTime.split(":").map(Number);
          if (
            isNaN(openHour) ||
            isNaN(openMin) ||
            isNaN(closeHour) ||
            isNaN(closeMin)
          )
            continue;

          const openTimeInMinutes = openHour * 60 + openMin;
          const closeTimeInMinutes = closeHour * 60 + closeMin;

          let isWithinSlot = false;
          if (closeTimeInMinutes < openTimeInMinutes) {
            isWithinSlot =
              currentTimeInMinutes >= openTimeInMinutes ||
              currentTimeInMinutes <= closeTimeInMinutes;
          } else {
            isWithinSlot =
              currentTimeInMinutes >= openTimeInMinutes &&
              currentTimeInMinutes < closeTimeInMinutes;
          }

          if (isWithinSlot) return { isOpen: true };
        }
        return { isOpen: false };
      }

      if (todayHours.openTime && todayHours.closeTime) {
        const [openHour, openMin] = todayHours.openTime.split(":").map(Number);
        const [closeHour, closeMin] = todayHours.closeTime
          .split(":")
          .map(Number);
        if (
          isNaN(openHour) ||
          isNaN(openMin) ||
          isNaN(closeHour) ||
          isNaN(closeMin)
        ) {
          return { isOpen: true };
        }

        const openTimeInMinutes = openHour * 60 + openMin;
        const closeTimeInMinutes = closeHour * 60 + closeMin;

        let isOpenStatus = false;
        if (closeTimeInMinutes < openTimeInMinutes) {
          isOpenStatus =
            currentTimeInMinutes >= openTimeInMinutes ||
            currentTimeInMinutes <= closeTimeInMinutes;
        } else {
          isOpenStatus =
            currentTimeInMinutes >= openTimeInMinutes &&
            currentTimeInMinutes < closeTimeInMinutes;
        }
        return { isOpen: isOpenStatus };
      }

      return { isOpen: true };
    };

    const shopOrders = [];
    for (const shopId of Object.keys(groupItemsByShop)) {
      const shop = await Shop.findById(shopId).populate("owner");
      if (!shop) {
        return res.status(400).json({ message: "shop not found" });
      }

      if (shop.isApproved !== true) {
        return res.status(403).json({
          message: `Cannot place order. ${shop.name} is not approved yet.`,
        });
      }

      if (shop.temporaryClosure?.isClosed === true) {
        return res.status(403).json({
          message: `Cannot place order. ${shop.name} is temporarily closed.`,
        });
      }

      // Check if shop is open
      const shopStatus = checkBusinessHours(shop.businessHours);
      if (!shopStatus.isOpen) {
        return res.status(400).json({
          message: `Cannot place order. ${shop.name} is currently closed.`,
        });
      }

      const items = groupItemsByShop[shopId];
      const subtotal = items.reduce(
        (sum, i) => sum + Number(i.price) * Number(i.quantity),
        0,
      );
      shopOrders.push({
        shop: shop._id,
        owner: shop.owner._id,
        subtotal,
        shopOrderItems: items.map((i) => ({
          item: i.id,
          price: i.price,
          quantity: i.quantity,
          name: i.name,
          selectedOptions: i.selectedOptions || {},
          additionalRequest: i.additionalRequest || "",
        })),
      });
    }

    // Calculate Delivery Fee Server-Side
    let calculatedDeliveryFee = 0;

    // Default values if settings not found
    const baseDeliveryFee = systemSettings?.baseDeliveryFee || 0;
    const pricePerKm = systemSettings?.pricePerKm || 5;

    // Use the first shop's location as cafeteria origin for distance calculation
    let cafeteriaOrigin = null;
    if (shopOrders.length > 0) {
      const firstShop = await Shop.findById(shopOrders[0].shop);
      if (
        firstShop &&
        firstShop.location &&
        firstShop.location.latitude &&
        firstShop.location.longitude
      ) {
        cafeteriaOrigin = {
          lat: firstShop.location.latitude,
          lng: firstShop.location.longitude,
        };
      }
    }

    if (
      deliveryAddress &&
      deliveryAddress.latitude &&
      deliveryAddress.longitude &&
      cafeteriaOrigin
    ) {
      const distance = calculateDistance(
        cafeteriaOrigin.lat,
        cafeteriaOrigin.lng,
        Number(deliveryAddress.latitude),
        Number(deliveryAddress.longitude),
      );

      // Fee Formula: Base + (Distance * Rate) -> Rounded Down (Remove decimal)
      calculatedDeliveryFee = Math.floor(
        baseDeliveryFee + distance * pricePerKm,
      );
    }

    // Cap the fee reasonable max if needed, or leave as is.
    // The user requirement didn't specify a max cap, but frontend has one.
    // We'll stick to the requested formula: ceil(base + dist * rate).

    console.log("💰 Server Calculated Delivery Fee:", calculatedDeliveryFee);

    // Enforce server-side totals
    const foodTotal = shopOrders.reduce(
      (sum, so) => sum + (Number(so.subtotal) || 0),
      0,
    );
    const normalizedDeliveryFee = calculatedDeliveryFee;
    const normalizedTotalAmount =
      Math.round((foodTotal + normalizedDeliveryFee) * 100) / 100;

    const newOrder = await Order.create({
      user: req.userId,
      paymentMethod,
      deliveryAddress,
      totalAmount: normalizedTotalAmount,
      deliveryFee: normalizedDeliveryFee, // Store delivery fee for delivery boy income calculation
      paymentFee: 0,
      shopOrders,
      payment: paymentMethod === "cod", // COD orders are always paid, online orders need verification
    });

    console.log("✅ Order created with deliveryFee:", newOrder.deliveryFee);

    await newOrder.populate(
      "shopOrders.shopOrderItems.item",
      "name image price",
    );
    await newOrder.populate("shopOrders.shop", "name");
    await newOrder.populate("shopOrders.owner", "socketId");
    await newOrder.populate("user", "fullName email mobile");

    const io = req.app.get("io");

    if (io) {
      newOrder.shopOrders.forEach((shopOrder) => {
        const ownerSocketId = shopOrder.owner.socketId;
        if (ownerSocketId) {
          const payload = {
            ...newOrder.toObject(),
            shopOrders: [shopOrder.toObject()],
          };
          io.to(ownerSocketId).emit("newOrder", payload);

          // Create Notification for Owner
          createNotification({
            recipient: shopOrder.owner._id,
            title: "New Order Received",
            message: `You have a new order #${newOrder._id} from ${newOrder.user?.fullName || "Guest"}`,
            type: "order_update",
            relatedId: newOrder._id,
            relatedModel: "Order",
          });
        }
      });
    }

    return res.status(201).json(newOrder);
  } catch (error) {
    return res.status(500).json({ message: `place order error ${error}` });
  }
};

export const getMyOrders = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (user.role == "user") {
      const orders = await Order.find({ user: req.userId })
        .sort({ createdAt: -1 })
        .populate("shopOrders.shop", "name")
        .populate("shopOrders.shopOrderItems.item", "name image price");
      return res.status(200).json(orders);
    } else if (user.role == "owner") {
      const orders = await Order.find({
        "shopOrders.owner": req.userId,
      })
        .sort({ createdAt: -1 })
        .populate("user", "fullName email mobile")
        .populate("shopOrders.shop", "name")
        .populate("shopOrders.shopOrderItems.item", "name image price");
      return res.status(200).json(orders);
    } else if (user.role == "delivery" || user.role == "deliveryBoy") {
      const orders = await Order.find({
        "shopOrders.assignedDeliveryBoy": req.userId,
      })
        .sort({ createdAt: -1 })
        .populate("user", "fullName email mobile")
        .populate("shopOrders.shop", "name")
        .populate("shopOrders.shopOrderItems.item", "name image price");
      return res.status(200).json(orders);
    }
  } catch (error) {
    return res.status(500).json({ message: `get my orders error ${error}` });
  }
};

export const updateOrderStatus = async (req, res) => {
  try {
    const { orderId, shopId } = req.params;
    const { status } = req.body;

    if (!orderId || !shopId || !status) {
      return res
        .status(400)
        .json({ message: "Order ID, Shop ID, and status are required" });
    }

    const order = await Order.findById(orderId)
      .populate("user", "socketId")
      .populate("shopOrders.shop", "name location address")
      .populate("shopOrders.assignedDeliveryBoy", "socketId");
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Find shopOrder by matching shop ID (handle both populated and unpopulated cases)
    const shopOrder = order.shopOrders.find((so) => {
      const shopIdValue = so.shop?._id
        ? so.shop._id.toString()
        : so.shop?.toString();
      return shopIdValue === shopId;
    });

    if (!shopOrder) {
      return res.status(404).json({ message: "Shop order not found" });
    }

    const previousStatus = shopOrder.status;
    shopOrder.status = status;

    // Track preparation time
    if (status === "preparing" && previousStatus !== "preparing") {
      // Order just moved to preparing - record start time
      shopOrder.preparingStartedAt = new Date();
    } else if (status === "out of delivery" && previousStatus === "preparing") {
      // Order moved from preparing to ready for delivery - record completion time
      shopOrder.readyForDeliveryAt = new Date();
    }

    const io = req.app.get("io");
    let assignmentPayload = null;
    let removalPayload = null;

    const settings = await SystemSettings.findOne({}).lean();
    const cafeteriaLocationByName = new Map(
      (settings?.cafeteriaSettings || [])
        .filter((c) => c?.name)
        .map((c) => [String(c.name), c.location || null]),
    );

    // Check if order already has an assigned delivery boy before status change
    const hadAssignedDeliveryBoy =
      shopOrder.assignedDeliveryBoy !== null &&
      shopOrder.assignedDeliveryBoy !== undefined;

    // Helper function to create assignment payload
    const createAssignmentPayload = () => {
      const shopDetails = shopOrder.shop;
      const shopIdValue = shopDetails?._id
        ? shopDetails._id.toString()
        : shopDetails?.toString() || "";

      const cafeteriaName = shopDetails?.cafeteria
        ? String(shopDetails.cafeteria)
        : "";
      const cafeteriaLoc = cafeteriaName
        ? cafeteriaLocationByName.get(cafeteriaName)
        : null;

      return {
        assignmentId: shopOrder._id.toString(),
        orderId: order._id.toString(),
        readableOrderId: order.orderId || null,
        shopOrderId: shopOrder._id.toString(),
        shopId: shopIdValue,
        shopName: shopDetails?.name || "",
        pickupLocation:
          cafeteriaLoc && cafeteriaLoc.lat != null && cafeteriaLoc.lng != null
            ? { latitude: cafeteriaLoc.lat, longitude: cafeteriaLoc.lng }
            : shopDetails?.location || null,
        shopAddress: shopDetails?.address || "",
        deliveryAddress: order.deliveryAddress,
        deliveryAddressText: order.deliveryAddress?.text || "",
        deliveryFee: order.deliveryFee || 0,
        subtotal: shopOrder.subtotal,
        status: shopOrder.status,
        createdAt: order.createdAt,
        items: shopOrder.shopOrderItems.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          price: item.price,
        })),
      };
    };

    // Emit assignment when status changes to "preparing" (first time) or "out of delivery" (if not already assigned)
    if (
      status === "preparing" &&
      previousStatus !== "preparing" &&
      !hadAssignedDeliveryBoy
    ) {
      // Order just moved to preparing - emit assignment so delivery boys can see it immediately
      assignmentPayload = createAssignmentPayload();
    } else if (status === "out of delivery" && !hadAssignedDeliveryBoy) {
      // Order is ready for pickup but no delivery boy assigned yet - emit assignment so delivery boys can see it
      assignmentPayload = createAssignmentPayload();
    } else if (
      previousStatus === "out of delivery" &&
      status !== "out of delivery"
    ) {
      // Order was removed from "out of delivery" status
      removalPayload = {
        assignmentId: shopOrder._id.toString(),
      };
    }

    await order.save();

    const shopIdForEmit =
      shopOrder.shop && shopOrder.shop._id
        ? shopOrder.shop._id.toString()
        : shopOrder.shop?.toString();

    const socketMap = req.app.get("socketMap");
    const statusUpdatePayload = {
      orderId: order._id.toString(),
      readableOrderId: order.orderId || null,
      shopId: shopIdForEmit,
      shopOrderId: shopOrder._id.toString(), // Add shopOrderId for precise frontend updates
      status: shopOrder.status,
    };

    // Emit status update to customer
    if (io && order.user?._id) {
      const userId = order.user._id.toString();
      const userSocketId =
        socketMap?.get(userId) || order.user?.socketId || userId;

      // Emit to specific socket ID (most reliable)
      io.to(userSocketId).emit("update-status", {
        ...statusUpdatePayload,
        userId: userId,
      });

      // Also emit to user room as backup (users join rooms with their userId)
      io.to(userId).emit("update-status", {
        ...statusUpdatePayload,
        userId: userId,
      });

      // Create Notification for Customer
      createNotification({
        recipient: order.user._id,
        title: "Order Status Updated",
        message: `Your order ${order.orderId || `#${order._id}`} is now ${shopOrder.status}`,
        type: "order_update",
        relatedId: order._id,
        relatedModel: "Order",
      });
    }

    // Emit status update to delivery boy if one is assigned
    if (io && shopOrder.assignedDeliveryBoy) {
      // Handle both populated and unpopulated cases
      const deliveryBoyId = shopOrder.assignedDeliveryBoy._id
        ? shopOrder.assignedDeliveryBoy._id.toString()
        : shopOrder.assignedDeliveryBoy.toString();

      if (deliveryBoyId) {
        const deliveryBoySocketId =
          socketMap?.get(deliveryBoyId) ||
          shopOrder.assignedDeliveryBoy?.socketId ||
          deliveryBoyId;

        console.log(
          "📤 Emitting status update to delivery boy:",
          deliveryBoyId,
          "Status:",
          shopOrder.status,
        );

        // Emit to specific socket ID (most reliable)
        io.to(deliveryBoySocketId).emit("update-status", statusUpdatePayload);

        // Also emit to deliverer room as backup
        io.to(deliveryBoyId).emit("update-status", statusUpdatePayload);

        // Create Notification for Delivery Boy
        createNotification({
          recipient: deliveryBoyId,
          title: "Order Update",
          message: `Order ${order.orderId || `#${order._id}`} status changed to ${shopOrder.status}`,
          type: "order_update",
          relatedId: order._id,
          relatedModel: "Order",
        });
      }
    }

    if (io) {
      await emitOrderStatusUpdated(io, order._id);
    }

    // Emit assignment to delivery boys if payload exists and no delivery boy was already assigned
    // This happens when status changes to "preparing" or "out of delivery"
    if (io && assignmentPayload) {
      const deliveryBoys = await User.find({
        role: "deliveryBoy",
        socketId: { $ne: null },
      }).select("socketId");

      deliveryBoys.forEach((boy) => {
        if (boy.socketId) {
          io.to(boy.socketId).emit("delivery-assignment", assignmentPayload);
        }
      });
    }

    if (io && removalPayload) {
      const deliveryBoys = await User.find({
        role: "deliveryBoy",
        socketId: { $ne: null },
      }).select("socketId");

      deliveryBoys.forEach((boy) => {
        if (boy.socketId) {
          io.to(boy.socketId).emit(
            "delivery-assignment-removed",
            removalPayload,
          );
        }
      });
    }

    // If status is "out of delivery", find available delivery boys for owner UI
    let availableBoys = [];
    if (status === "out of delivery") {
      availableBoys = await User.find({ role: "deliveryBoy" })
        .select("fullName mobile location")
        .limit(10);
    }

    res.status(200).json({
      message: "Order status updated successfully",
      availableBoys: availableBoys,
      assignment: assignmentPayload,
    });
  } catch (error) {
    res.status(500).json({ message: `update order status error ${error}` });
  }
};

// Haversine formula to calculate distance between two coordinates in kilometers
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in kilometers
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in kilometers
};

// Calculate visibility delay in seconds based on distance
// Rules: within 100m (0.1km) = 1 second, within 1km = 10 seconds, and so on
const calculateVisibilityDelay = (distanceInKm) => {
  if (distanceInKm === null || distanceInKm === undefined) {
    // If distance is unknown, show after a longer delay (e.g., 60 seconds)
    return 60;
  }

  // Convert to meters for easier calculation
  const distanceInMeters = distanceInKm * 1000;

  // Within 100 meters: 1 second
  if (distanceInMeters <= 100) {
    return 1;
  }

  // Within 1 km (100m to 1000m): 10 seconds
  if (distanceInMeters <= 1000) {
    return 10;
  }

  // Beyond 1 km: 10 seconds + 10 seconds per additional km
  // Example: 1.5km = 15 seconds, 2km = 20 seconds, 3km = 30 seconds
  const additionalKm = distanceInKm - 1;
  return 10 + Math.ceil(additionalKm * 10);
};

export const getDeliveryBoyAssignment = async (req, res) => {
  try {
    // Get deliverer's current location
    const deliverer = await User.findById(req.userId).select("location").lean();

    const delivererLocation = deliverer?.location?.coordinates;
    const delivererLat = delivererLocation?.[1]; // latitude is at index 1
    const delivererLon = delivererLocation?.[0]; // longitude is at index 0

    const settings = await SystemSettings.findOne({}).lean();
    const cafeteriaLocationByName = new Map(
      (settings?.cafeteriaSettings || [])
        .filter((c) => c?.name)
        .map((c) => [String(c.name), c.location || null]),
    );

    // Only include orders that are available for delivery boys to accept
    // This includes orders that are accepted, being cooked, prepared, or ready for pickup but NOT yet assigned
    const orders = await Order.find({
      shopOrders: {
        $elemMatch: {
          status: {
            $in: [
              "accepted",
              "being_cooked",
              "preparing",
              "prepared",
              "out of delivery",
            ],
          },
          assignedDeliveryBoy: null,
        },
      },
    })
      .populate("shopOrders.shop", "name location address cafeteria")
      .lean();

    const assignments = [];

    console.log("=== DELIVERY ASSIGNMENTS DEBUG ===");
    console.log("Found orders:", orders.length);

    orders.forEach((order) => {
      order.shopOrders.forEach((shopOrder) => {
        const isEligibleStatus =
          shopOrder.status === "accepted" ||
          shopOrder.status === "being_cooked" ||
          shopOrder.status === "preparing" ||
          shopOrder.status === "prepared" ||
          shopOrder.status === "out of delivery";
        const isNotAssigned = !shopOrder.assignedDeliveryBoy;

        console.log(`Order ${order._id} - ShopOrder ${shopOrder._id}:`);
        console.log(`  - Status: ${shopOrder.status}`);
        console.log(
          `  - Assigned: ${shopOrder.assignedDeliveryBoy ? "Yes" : "No"}`,
        );
        console.log(`  - Eligible: ${isEligibleStatus && isNotAssigned}`);

        if (isEligibleStatus && isNotAssigned) {
          const cafeteriaName = shopOrder.shop?.cafeteria
            ? String(shopOrder.shop.cafeteria)
            : "";
          const cafeteriaLoc = cafeteriaName
            ? cafeteriaLocationByName.get(cafeteriaName)
            : null;

          const pickupLocation =
            cafeteriaLoc && cafeteriaLoc.lat != null && cafeteriaLoc.lng != null
              ? { latitude: cafeteriaLoc.lat, longitude: cafeteriaLoc.lng }
              : shopOrder.shop?.location || null;

          // Calculate distance from deliverer to shop pickup location
          let distance = null;
          if (
            delivererLat != null &&
            delivererLon != null &&
            pickupLocation?.latitude != null &&
            pickupLocation?.longitude != null
          ) {
            distance = calculateDistance(
              delivererLat,
              delivererLon,
              pickupLocation.latitude,
              pickupLocation.longitude,
            );
          }

          // Calculate visibility delay based on distance
          const visibilityDelay = calculateVisibilityDelay(distance);

          console.log(`  - Distance: ${distance} km`);
          console.log(`  - Visibility Delay: ${visibilityDelay} seconds`);
          console.log(`  - Shop: ${shopOrder.shop?.name}`);
          console.log(`  - Created: ${order.createdAt}`);

          assignments.push({
            assignmentId: shopOrder._id.toString(),
            orderId: order._id.toString(),
            readableOrderId: order.orderId || null,
            shopOrderId: shopOrder._id.toString(),
            shopId: shopOrder.shop?._id?.toString() || "",
            shopName: shopOrder.shop?.name || "",
            shopCafeteria: shopOrder.shop?.cafeteria || "",
            pickupLocation,
            shopAddress: shopOrder.shop?.address || "",
            deliveryAddress: order.deliveryAddress,
            deliveryAddressText: order.deliveryAddress?.text || "",
            deliveryFee: order.deliveryFee || 0,
            subtotal: shopOrder.subtotal,
            status: shopOrder.status, // Include status so frontend can display it
            createdAt: order.createdAt,
            distance, // Include distance in kilometers (null if location unavailable)
            visibilityDelay, // Delay in seconds before this job becomes visible
            items: shopOrder.shopOrderItems.map((item) => ({
              name: item.name,
              quantity: item.quantity,
              price: item.price,
            })),
          });
        }
      });
    });

    console.log(`Total assignments to return: ${assignments.length}`);
    console.log("=== END DEBUG ===");

    // Sort assignments by distance (nearest first)
    // Assignments without distance (null) will be placed at the end
    assignments.sort((a, b) => {
      if (a.distance === null && b.distance === null) return 0;
      if (a.distance === null) return 1; // Put null distances at the end
      if (b.distance === null) return -1;
      return a.distance - b.distance; // Sort by distance ascending
    });

    res.status(200).json(assignments);
  } catch (error) {
    res
      .status(500)
      .json({ message: `get delivery boy assignment error ${error}` });
  }
};

// Cancel job assignment - Deliverer unassigns themselves, job becomes available again
export const cancelJobAssignment = async (req, res) => {
  try {
    const { orderId, shopId } = req.params;

    if (!orderId || !shopId) {
      return res.status(400).json({
        message: "Order ID and Shop ID are required",
      });
    }

    const order = await Order.findById(orderId)
      .populate("shopOrders.shop", "name location address cafeteria")
      .populate("shopOrders.assignedDeliveryBoy", "_id")
      .populate("user", "socketId fullName");

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Find shopOrder by matching shop ID
    const shopOrder = order.shopOrders.find((so) => {
      const shopIdValue = so.shop?._id
        ? so.shop._id.toString()
        : so.shop?.toString();
      return shopIdValue === shopId;
    });

    if (!shopOrder) {
      return res.status(404).json({ message: "Shop order not found" });
    }

    // Verify the deliverer is assigned to this job
    const assignedDeliveryBoyId = shopOrder.assignedDeliveryBoy?._id
      ? shopOrder.assignedDeliveryBoy._id.toString()
      : shopOrder.assignedDeliveryBoy?.toString();

    if (
      !assignedDeliveryBoyId ||
      assignedDeliveryBoyId !== req.userId.toString()
    ) {
      return res.status(403).json({
        message: "You are not assigned to this job",
      });
    }

    // Check if order was already picked up (can't cancel after pickup)
    if (shopOrder.pickedUpAt) {
      return res.status(400).json({
        message: "Cannot cancel job. Order has already been picked up.",
      });
    }

    // Only allow canceling if status is "preparing" or "out of delivery"
    if (
      shopOrder.status !== "preparing" &&
      shopOrder.status !== "out of delivery"
    ) {
      return res.status(400).json({
        message: `Cannot cancel job. Order status is: ${shopOrder.status}`,
      });
    }

    // Update the order: unassign the deliverer
    const updatedOrder = await Order.findOneAndUpdate(
      {
        _id: orderId,
        "shopOrders._id": shopOrder._id,
      },
      {
        $set: {
          "shopOrders.$.assignedDeliveryBoy": null,
        },
      },
      { new: true },
    )
      .populate("shopOrders.shop", "name location address cafeteria")
      .populate("user", "socketId fullName");

    if (!updatedOrder) {
      return res.status(404).json({ message: "Order not found" });
    }

    const updatedShopOrder = updatedOrder.shopOrders.find((so) => {
      const shopIdValue = so.shop?._id
        ? so.shop._id.toString()
        : so.shop?.toString();
      return shopIdValue === shopId;
    });

    const io = req.app.get("io");
    const socketMap = req.app.get("socketMap");

    // Create assignment payload to broadcast to all delivery boys
    const settings = await SystemSettings.findOne({}).lean();
    const cafeteriaLocationByName = new Map(
      (settings?.cafeteriaSettings || [])
        .filter((c) => c?.name)
        .map((c) => [String(c.name), c.location || null]),
    );

    const cafeteriaName = updatedShopOrder.shop?.cafeteria
      ? String(updatedShopOrder.shop.cafeteria)
      : "";
    const cafeteriaLoc = cafeteriaName
      ? cafeteriaLocationByName.get(cafeteriaName)
      : null;

    const pickupLocation =
      cafeteriaLoc && cafeteriaLoc.lat != null && cafeteriaLoc.lng != null
        ? { latitude: cafeteriaLoc.lat, longitude: cafeteriaLoc.lng }
        : updatedShopOrder.shop?.location || null;

    const assignmentPayload = {
      assignmentId: updatedShopOrder._id.toString(),
      orderId: updatedOrder._id.toString(),
      readableOrderId: updatedOrder.orderId || null,
      shopOrderId: updatedShopOrder._id.toString(),
      shopId: updatedShopOrder.shop?._id?.toString() || "",
      shopName: updatedShopOrder.shop?.name || "",
      shopCafeteria: updatedShopOrder.shop?.cafeteria || "",
      pickupLocation,
      shopAddress: updatedShopOrder.shop?.address || "",
      deliveryAddress: updatedOrder.deliveryAddress,
      deliveryAddressText: updatedOrder.deliveryAddress?.text || "",
      deliveryFee: updatedOrder.deliveryFee || 0,
      subtotal: updatedShopOrder.subtotal,
      status: updatedShopOrder.status,
      createdAt: updatedOrder.createdAt,
      items: updatedShopOrder.shopOrderItems.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        price: item.price,
      })),
    };

    // Emit new assignment to all delivery boys
    if (io) {
      const deliveryBoys = await User.find({
        role: "deliveryBoy",
        socketId: { $ne: null },
      }).select("socketId");

      deliveryBoys.forEach((boy) => {
        if (boy.socketId) {
          io.to(boy.socketId).emit("delivery-assignment", assignmentPayload);
        }
      });
    }

    // Notify the deliverer who canceled
    const deliveryBoySocketId = socketMap?.get(req.userId) || req.userId;

    if (io) {
      io.to(deliveryBoySocketId).emit("job-cancelled", {
        orderId: updatedOrder._id.toString(),
        shopOrderId: updatedShopOrder._id.toString(),
        message:
          "You have successfully cancelled this job. It is now available for other deliverers.",
      });
    }

    // Create notification
    createNotification({
      recipient: req.userId,
      title: "Job Cancelled",
      message: `You have cancelled the job for order ${updatedOrder.orderId || `#${updatedOrder._id}`}. The job is now available for other deliverers.`,
      type: "delivery_assignment",
      relatedId: updatedOrder._id,
      relatedModel: "Order",
    });

    res.status(200).json({
      message:
        "Job cancelled successfully. The job is now available for other deliverers.",
      order: {
        _id: updatedOrder._id,
        shopOrder: {
          _id: updatedShopOrder._id,
          status: updatedShopOrder.status,
          assignedDeliveryBoy: null,
        },
      },
    });
  } catch (error) {
    console.error("Cancel job assignment error:", error);
    res.status(500).json({
      message: `Cancel job assignment error: ${error.message}`,
    });
  }
};

export const acceptOrder = async (req, res) => {
  try {
    const { assignmentId } = req.params;

    if (!assignmentId) {
      return res.status(400).json({ message: "Assignment ID is required" });
    }

    const deliveryBoyId = mongoose.Types.ObjectId.isValid(req.userId)
      ? new mongoose.Types.ObjectId(req.userId)
      : null;
    const assignedDeliveryBoyValue = deliveryBoyId || req.userId;

    const order = await Order.findOneAndUpdate(
      {
        "shopOrders._id": assignmentId,
        "shopOrders.status": { $in: ["preparing", "out of delivery"] },
        "shopOrders.assignedDeliveryBoy": null,
      },
      {
        $set: {
          "shopOrders.$.assignedDeliveryBoy": assignedDeliveryBoyValue,
        },
      },
      { new: true },
    )
      .populate("user", "socketId fullName")
      .populate("shopOrders.shop", "name");

    if (!order) {
      return res
        .status(404)
        .json({ message: "Assignment not found or already taken" });
    }

    const shopOrder = order.shopOrders.find(
      (so) => so._id.toString() === assignmentId,
    );

    if (!shopOrder) {
      return res.status(404).json({ message: "Shop order not found" });
    }

    const io = req.app.get("io");
    const socketMap = req.app.get("socketMap");
    if (io && order.user?._id) {
      const userId = order.user._id.toString();
      const userSocketId =
        socketMap?.get(userId) || order.user?.socketId || userId;

      const payload = {
        orderId: order._id.toString(),
        shopId:
          shopOrder.shop && shopOrder.shop._id
            ? shopOrder.shop._id.toString()
            : shopOrder.shop?.toString(),
        shopOrderId: shopOrder._id.toString(),
        status: shopOrder.status,
        userId: userId,
      };

      // Emit to specific socket ID (most reliable)
      io.to(userSocketId).emit("update-status", payload);

      // Also emit to user room as backup
      io.to(userId).emit("update-status", payload);

      // Create Notification for Customer
      createNotification({
        recipient: order.user._id,
        title: "Order Accepted",
        message: `Your order ${order.orderId || `#${order._id}`} has been accepted by a driver`,
        type: "order_update",
        relatedId: order._id,
        relatedModel: "Order",
      });
    }

    // Create Notification for Delivery Boy (the rider who accepted)
    createNotification({
      recipient: req.userId,
      title: "New Order Received",
      message: `You have a new order ${order.orderId ? order.orderId : `#${order._id}`} from ${order.user?.fullName || "Customer"}`,
      type: "delivery_assignment",
      relatedId: order._id,
      relatedModel: "Order",
    });

    if (io) {
      const payload = { assignmentId };
      const deliveryBoys = await User.find({
        role: "deliveryBoy",
        socketId: { $ne: null },
      }).select("socketId");

      deliveryBoys.forEach((boy) => {
        if (boy.socketId) {
          io.to(boy.socketId).emit("delivery-assignment-removed", payload);
        }
      });
    }

    if (io) {
      await emitOrderStatusUpdated(io, order._id);
    }

    res.status(200).json({ message: "Order accepted successfully" });
  } catch (error) {
    console.error("acceptOrder error:", error);
    res.status(500).json({ message: `accept order error ${error.message}` });
  }
};

export const getCurrentOrder = async (req, res) => {
  try {
    const deliveryBoyId = mongoose.Types.ObjectId.isValid(req.userId)
      ? new mongoose.Types.ObjectId(req.userId)
      : null;

    // Include both "preparing" and "out of delivery" statuses
    // Delivery boys can accept orders in "preparing" status and should be able to see them
    const order = await Order.findOne({
      shopOrders: {
        $elemMatch: {
          assignedDeliveryBoy: deliveryBoyId
            ? { $in: [deliveryBoyId, req.userId] }
            : req.userId,
          status: { $in: ["preparing", "out of delivery"] }, // Show orders that are being prepared or ready for delivery
        },
      },
    })
      .populate(
        "shopOrders.shop",
        "name location address cafeteria shopNumber owner",
      )
      .populate("shopOrders.shop.owner", "fullName mobile phone phoneNumber")
      .populate("shopOrders.owner", "fullName mobile phone phoneNumber")
      .populate("shopOrders.shopOrderItems.item", "name image price")
      .populate(
        "shopOrders.assignedDeliveryBoy",
        "fullName mobile location currentAddress email",
      )
      .populate("user", "fullName mobile email location");

    if (!order) {
      // Return 200 with null instead of 404 - no order is expected when delivery boy has no active orders
      return res.status(200).json(null);
    }

    const shopOrder = order.shopOrders.find((so) => {
      const assigned =
        typeof so.assignedDeliveryBoy === "object" && so.assignedDeliveryBoy
          ? so.assignedDeliveryBoy._id || so.assignedDeliveryBoy.id
          : so.assignedDeliveryBoy;
      return (
        assigned &&
        assigned.toString().trim() === req.userId.toString().trim() &&
        (so.status === "preparing" || so.status === "out of delivery") // Return orders that are being prepared or ready for delivery
      );
    });

    if (!shopOrder) {
      // Return 200 with null instead of 404 - no order is expected when delivery boy has no active orders
      return res.status(200).json(null);
    }

    res.status(200).json({
      _id: order._id,
      deliveryAddress: order.deliveryAddress,
      totalAmount: order.totalAmount,
      deliveryFee: order.deliveryFee || 0,
      paymentMethod: order.paymentMethod, // Include paymentMethod for COD check
      user: order.user,
      shopOrder: shopOrder.toObject ? shopOrder.toObject() : shopOrder, // Ensure shopOrder is a plain object with subtotal
    });
  } catch (error) {
    res.status(500).json({ message: `get current order error ${error}` });
  }
};

export const getOrderById = async (req, res) => {
  try {
    const { orderId } = req.params;
    console.log("getOrderById called for:", orderId);
    const order = await Order.findById(orderId)
      .populate("shopOrders.shop", "name location address shopNumber")
      .populate("shopOrders.shopOrderItems.item", "name image price")
      .populate(
        "shopOrders.assignedDeliveryBoy",
        "fullName mobile location currentAddress email profileImage",
      )
      .populate("user", "fullName email mobile");

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Check review status for each shop order
    const userId = order.user._id;

    for (let shopOrder of order.shopOrders) {
      // Check if restaurant is reviewed for this shop order
      const restaurantReview = await Review.findOne({
        shop: shopOrder.shop._id,
        user: userId,
        shopOrder: shopOrder._id,
      });
      shopOrder.isRestaurantReviewed = !!restaurantReview;

      // Check if driver is reviewed for this shop order
      if (shopOrder.assignedDeliveryBoy) {
        console.log("Checking driver review with exact values:", {
          rider: shopOrder.assignedDeliveryBoy._id,
          user: userId,
          shopOrder: shopOrder._id,
          riderType: typeof shopOrder.assignedDeliveryBoy._id,
          userType: typeof userId,
          shopOrderType: typeof shopOrder._id,
        });

        const driverReview = await RiderReview.findOne({
          rider: shopOrder.assignedDeliveryBoy._id,
          user: userId,
          shopOrder: shopOrder._id,
        });

        console.log("Driver review check for order:", {
          shopOrderId: shopOrder._id,
          userId,
          riderId: shopOrder.assignedDeliveryBoy._id,
          found: !!driverReview,
          driverReviewDetails: driverReview,
        });
        const driverReviewed = !!driverReview;
        shopOrder.isDriverReviewed = driverReviewed;

        // Also set it directly on the order object to ensure it's included
        const shopOrderIndex = order.shopOrders.findIndex(
          (so) => so._id.toString() === shopOrder._id.toString(),
        );
        if (shopOrderIndex !== -1) {
          order.shopOrders[shopOrderIndex].isDriverReviewed = driverReviewed;
        }
      } else {
        console.log("No assigned driver for shop order:", shopOrder._id);
        const driverReviewed = false;
        shopOrder.isDriverReviewed = driverReviewed;

        // Also set it directly on the order object
        const shopOrderIndex = order.shopOrders.findIndex(
          (so) => so._id.toString() === shopOrder._id.toString(),
        );
        if (shopOrderIndex !== -1) {
          order.shopOrders[shopOrderIndex].isDriverReviewed = driverReviewed;
        }
      }
    }

    console.log(
      "Final order data with review flags:",
      order.shopOrders.map((so) => ({
        shopOrderId: so._id,
        isDriverReviewed: so.isDriverReviewed,
        isRestaurantReviewed: so.isRestaurantReviewed,
        assignedDeliveryBoy: so.assignedDeliveryBoy?._id,
      })),
    );

    // FORCE SET: Double-check and force set the driver reviewed flag
    for (let index = 0; index < order.shopOrders.length; index++) {
      const so = order.shopOrders[index];
      if (so.assignedDeliveryBoy) {
        const driverReview = await RiderReview.findOne({
          rider: so.assignedDeliveryBoy._id,
          user: userId,
          shopOrder: so._id,
        });
        const driverReviewed = !!driverReview;

        console.log(
          `FORCE SET - ShopOrder ${so._id}: Driver reviewed = ${driverReviewed}`,
        );

        // Force set on both the subdocument and the array
        so.isDriverReviewed = driverReviewed;
        order.shopOrders[index].isDriverReviewed = driverReviewed;
      }
    }

    // Convert to plain object to ensure all fields are included in JSON response
    const orderObject = order.toObject ? order.toObject() : order;

    console.log("Sending order to frontend:", {
      shopOrders: orderObject.shopOrders.map((so) => ({
        shopOrderId: so._id,
        isDriverReviewed: so.isDriverReviewed,
        isRestaurantReviewed: so.isRestaurantReviewed,
      })),
    });

    // Final verification before sending
    console.log(
      "FINAL VERIFICATION - Order object before sending:",
      JSON.stringify(
        orderObject.shopOrders.map((so) => ({
          shopOrderId: so._id,
          isDriverReviewed: so.isDriverReviewed,
        })),
      ),
    );

    res.status(200).json(orderObject);
  } catch (error) {
    res.status(500).json({ message: `get order by id error ${error}` });
  }
};

export const sendDeliveryOtp = async (req, res) => {
  try {
    const { orderId, shopOrderId } = req.body;
    if (!orderId || !shopOrderId) {
      return res
        .status(400)
        .json({ message: "orderId and shopOrderId are required" });
    }

    const order = await Order.findById(orderId)
      .populate("user", "email")
      .populate("shopOrders.shop", "name")
      .populate("shopOrders.assignedDeliveryBoy", "_id jobCredit");

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const shopOrder = order.shopOrders.find(
      (so) => so._id.toString() === shopOrderId,
    );

    if (!shopOrder) {
      return res.status(404).json({ message: "Shop order not found" });
    }

    // Only allow pickup (sending OTP) when order status is "out of delivery"
    // If status is "preparing", delivery boy can accept and travel to restaurant, but cannot pickup yet
    if (shopOrder.status !== "out of delivery") {
      return res.status(400).json({
        message: `Order is still being prepared. Current status: ${shopOrder.status}. Please wait until the order is ready for pickup.`,
      });
    }

    // For COD orders, deduct the NET amount from delivery boy's credit when confirming pickup
    // This happens when delivery boy confirms they've picked up the food from the restaurant
    if (
      order.paymentMethod === "cod" &&
      shopOrder.subtotal &&
      shopOrder.assignedDeliveryBoy
    ) {
      const gpRate = await getGpRate();
      const deliveryBoyId = shopOrder.assignedDeliveryBoy?._id
        ? shopOrder.assignedDeliveryBoy._id.toString()
        : shopOrder.assignedDeliveryBoy?.toString();

      if (deliveryBoyId) {
        const grossSubtotalAmount = Number(shopOrder.subtotal) || 0;
        const netSubtotalAmount =
          Math.round(grossSubtotalAmount * (1 - gpRate) * 100) / 100;

        // Deduct net subtotal from delivery boy's credit (this is the amount they pay the restaurant)
        const deliveryBoy = await User.findByIdAndUpdate(
          deliveryBoyId,
          { $inc: { jobCredit: -netSubtotalAmount } },
          { new: true },
        );

        if (deliveryBoy) {
          console.log("Deducted COD pickup amount from delivery boy credit:", {
            paymentMethod: order.paymentMethod,
            deliveryBoyId,
            grossSubtotalAmount,
            netSubtotalAmount,
            previousCredit: (deliveryBoy.jobCredit || 0) + netSubtotalAmount,
            newCredit: deliveryBoy.jobCredit,
          });

          // Emit socket event to update delivery boy's credit in real time
          const io = req.app.get("io");
          const socketMap = req.app.get("socketMap");
          if (io) {
            const userSocketId =
              socketMap?.get(deliveryBoyId) || deliveryBoy.socketId;
            if (userSocketId) {
              io.to(userSocketId).emit("job-credit-updated", {
                jobCredit: deliveryBoy.jobCredit,
              });
            }
          }
        } else {
          console.error(
            "Delivery boy not found for credit deduction:",
            deliveryBoyId,
          );
        }
      }
    }

    // If OTP already exists and hasn't expired, return it instead of generating a new one
    // Note: Credit was already deducted when OTP was first generated
    if (shopOrder.deliveryOtp) {
      const isExpired =
        shopOrder.otpExpires && new Date(shopOrder.otpExpires) < new Date();

      if (!isExpired) {
        // Return existing valid OTP
        return res.status(200).json({
          message: "OTP already generated. Using existing OTP.",
          otp: shopOrder.deliveryOtp,
        });
      }
      // If expired, clear it and generate a new one
      shopOrder.deliveryOtp = undefined;
      shopOrder.otpExpires = undefined;
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    shopOrder.deliveryOtp = otp;
    shopOrder.otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await order.save();

    let recipientEmail = order.user?.email;
    if (!recipientEmail) {
      const userRecord = await User.findById(order.user).select("email");
      recipientEmail = userRecord?.email || "";
    }

    if (!recipientEmail && shopOrder.assignedDeliveryBoy) {
      const deliveryBoy = await User.findById(
        shopOrder.assignedDeliveryBoy,
      ).select("email");
      recipientEmail = deliveryBoy?.email || "";
    }

    if (!recipientEmail) {
      return res
        .status(400)
        .json({ message: "Customer email not available for OTP delivery" });
    }

    await sendDeliveryOtpMail(recipientEmail, otp);
    res.status(200).json({ message: "OTP sent successfully", otp });
  } catch (error) {
    res.status(500).json({ message: `send delivery otp error ${error}` });
  }
};

export const verifyDeliveryOtp = async (req, res) => {
  try {
    const { orderId, shopOrderId, otp } = req.body;
    if (!orderId || !shopOrderId || !otp) {
      return res
        .status(400)
        .json({ message: "orderId, shopOrderId and otp are required" });
    }

    const order = await Order.findById(orderId)
      .populate("user", "socketId")
      .populate("shopOrders.owner", "socketId _id")
      .populate("shopOrders.assignedDeliveryBoy", "_id jobCredit");
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const shopOrder = order.shopOrders.find(
      (so) => so._id.toString() === shopOrderId,
    );

    if (!shopOrder) {
      return res.status(404).json({ message: "Shop order not found" });
    }

    if (
      shopOrder.deliveryOtp !== otp ||
      (shopOrder.otpExpires && shopOrder.otpExpires < new Date())
    ) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    shopOrder.deliveryOtp = null;
    shopOrder.otpExpires = null;
    shopOrder.status = "delivered";
    shopOrder.deliveredAt = new Date(); // Set delivery timestamp
    await order.save();

    // Note: Credit was already deducted when delivery boy confirmed pickup (in sendDeliveryOtp)

    const io = req.app.get("io");
    const socketMap = req.app.get("socketMap");

    if (io) {
      // Get owner ID (handle both populated and unpopulated cases)
      const ownerId = shopOrder.owner?._id
        ? shopOrder.owner._id.toString()
        : shopOrder.owner?.toString() || "";

      const socketMap = req.app.get("socketMap");
      const payload = {
        orderId: order._id.toString(),
        readableOrderId: order.orderId || null,
        shopId: shopOrder.shop?._id?.toString() || "",
        shopOrderId: shopOrder._id.toString(),
        status: "delivered",
        userId: order.user?._id?.toString() || "", // Customer ID for customer updates
        ownerId: ownerId, // Owner ID for owner updates
      };

      // Notify customer
      if (order.user?._id) {
        const userId = order.user._id.toString();
        const userSocketId =
          socketMap?.get(userId) || order.user?.socketId || userId;

        // Emit to specific socket ID (most reliable)
        io.to(userSocketId).emit("update-status", {
          ...payload,
          userId: userId,
        });

        // Also emit to user room as backup
        io.to(userId).emit("update-status", {
          ...payload,
          userId: userId,
        });

        createNotification({
          recipient: order.user._id,
          title: "Order Delivered",
          message: `Your order ${order.orderId || `#${order._id}`} has been delivered. Enjoy!`,
          type: "order_update",
          relatedId: order._id,
          relatedModel: "Order",
        });
      }

      // Notify owner
      if (ownerId) {
        const ownerSocketId =
          socketMap?.get(ownerId) || shopOrder.owner?.socketId || ownerId;

        // Emit to specific socket ID (most reliable)
        io.to(ownerSocketId).emit("update-status", {
          ...payload,
          userId: order.user?._id?.toString() || "",
        });

        // Also emit to owner room as backup
        io.to(ownerId).emit("update-status", {
          ...payload,
          userId: order.user?._id?.toString() || "",
        });

        createNotification({
          recipient: ownerId,
          title: "Order Delivered",
          message: `Order ${order.orderId || `#${order._id}`} has been delivered successfully.`,
          type: "order_update",
          relatedId: order._id,
          relatedModel: "Order",
        });
      }
    }

    res.status(200).json({ message: "OTP verified successfully" });
  } catch (error) {
    res.status(500).json({ message: `verify delivery otp error ${error}` });
  }
};

// Confirm pickup without OTP (replaces sendDeliveryOtp for simplified flow)
export const confirmPickup = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { orderId, shopOrderId } = req.body;
    if (!orderId || !shopOrderId) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(400)
        .json({ message: "orderId and shopOrderId are required" });
    }

    const order = await Order.findById(orderId)
      .populate("user", "socketId")
      .populate("shopOrders.shop", "name")
      .populate("shopOrders.assignedDeliveryBoy", "_id jobCredit")
      .session(session);

    if (!order) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Order not found" });
    }

    const shopOrder = order.shopOrders.find(
      (so) => so._id.toString() === shopOrderId,
    );

    if (!shopOrder) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Shop order not found" });
    }

    // Idempotency: prevent double processing when client retries
    if (shopOrder.pickedUpAt) {
      await session.abortTransaction();
      session.endSession();
      return res.status(200).json({ message: "Pickup already confirmed" });
    }

    // Only allow pickup when order status is "out of delivery"
    if (shopOrder.status !== "out of delivery") {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        message: `Order is still being prepared. Current status: ${shopOrder.status}. Please wait until the order is ready for pickup.`,
      });
    }

    const gpRate = await getGpRate();
    const shopId = shopOrder.shop?._id
      ? shopOrder.shop._id.toString()
      : shopOrder.shop?.toString();

    // Process payment for shop immediately at pickup
    // This applies to both COD and online payments
    if (shopOrder.subtotal && shopId) {
      const grossAmount = Number(shopOrder.subtotal) || 0;
      const netAmount = Math.round(grossAmount * (1 - gpRate) * 100) / 100;

      // Load shop with session for transaction
      const shop = await Shop.findById(shopId).session(session);
      if (shop) {
        // Idempotency check: prevent double payment
        const alreadyCredited = Array.isArray(shop.payments)
          ? shop.payments.some(
              (p) =>
                p?.orderId && p.orderId.toString() === order._id.toString(),
            )
          : false;

        if (!alreadyCredited) {
          // Determine payment method details
          const isOnlinePayment = ["online", "promptpay", "card"].includes(
            String(order.paymentMethod || "").toLowerCase(),
          );

          shop.payments.push({
            chargeId: isOnlinePayment
              ? order.stripePaymentId || `ORDER-${order._id}`
              : `COD-${order._id}`,
            paymentIntentId: isOnlinePayment
              ? order.stripePaymentId || null
              : null,
            orderId: order._id,
            amount: netAmount,
            currency: "thb",
            status: "succeeded",
            receiptUrl: null,
          });
          await shop.save({ session });
          console.log("Shop payment credited at pickup:", {
            shopId,
            orderId: order._id.toString(),
            paymentMethod: order.paymentMethod,
            grossAmount,
            netAmount,
            gpRate,
          });
        }
      }
    }

    // Deduct rider credit only for COD orders (offline).
    // Rider uses jobCredit to pay the restaurant at pickup and later collects cash from customer.
    if (
      String(order.paymentMethod || "").toLowerCase() === "cod" &&
      shopOrder.subtotal &&
      shopOrder.assignedDeliveryBoy
    ) {
      const deliveryBoyId = shopOrder.assignedDeliveryBoy?._id
        ? shopOrder.assignedDeliveryBoy._id.toString()
        : shopOrder.assignedDeliveryBoy?.toString();

      if (deliveryBoyId) {
        const grossSubtotalAmount = Number(shopOrder.subtotal) || 0;
        const netSubtotalAmount =
          Math.round(grossSubtotalAmount * (1 - gpRate) * 100) / 100;

        // Deduct net subtotal from delivery boy's credit (this is the amount they pay the restaurant)
        const deliveryBoy = await User.findByIdAndUpdate(
          deliveryBoyId,
          { $inc: { jobCredit: -netSubtotalAmount } },
          { new: true, session },
        );

        if (deliveryBoy) {
          console.log("Deducted pickup amount from delivery boy credit:", {
            paymentMethod: order.paymentMethod,
            deliveryBoyId,
            grossSubtotalAmount,
            netSubtotalAmount,
            previousCredit: (deliveryBoy.jobCredit || 0) + netSubtotalAmount,
            newCredit: deliveryBoy.jobCredit,
          });
        } else {
          console.error(
            "Delivery boy not found for credit deduction:",
            deliveryBoyId,
          );
        }
      }
    }

    // Mark pickup time (optional, for tracking)
    shopOrder.pickedUpAt = new Date();
    await order.save({ session });

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    // Emit socket events after successful transaction
    const io = req.app.get("io");
    if (io) {
      // Emit delivery boy credit update if COD
      if (
        String(order.paymentMethod || "").toLowerCase() === "cod" &&
        shopOrder.assignedDeliveryBoy
      ) {
        const deliveryBoyId = shopOrder.assignedDeliveryBoy?._id
          ? shopOrder.assignedDeliveryBoy._id.toString()
          : shopOrder.assignedDeliveryBoy?.toString();
        if (deliveryBoyId) {
          const socketMap = req.app.get("socketMap");
          const deliveryBoy =
            await User.findById(deliveryBoyId).select("jobCredit socketId");
          if (deliveryBoy) {
            const deliveryBoySocketId =
              socketMap?.get(deliveryBoyId) ||
              deliveryBoy.socketId ||
              deliveryBoyId;

            const creditPayload = {
              jobCredit: deliveryBoy.jobCredit,
            };

            // Emit to specific socket ID (most reliable)
            io.to(deliveryBoySocketId).emit(
              "job-credit-updated",
              creditPayload,
            );

            // Also emit to deliverer room as backup
            io.to(deliveryBoyId).emit("job-credit-updated", creditPayload);
          }
        }
      }

      // Notify shop owner about payment update
      if (shopId) {
        const shop = await Shop.findById(shopId).populate(
          "owner",
          "socketId _id",
        );
        if (shop?.owner?._id) {
          const ownerId = shop.owner._id.toString();
          const socketMap = req.app.get("socketMap");
          const ownerSocketId =
            socketMap?.get(ownerId) || shop.owner.socketId || ownerId;

          // Emit payment update
          io.to(ownerSocketId).emit("shop-payment-updated", {
            shopId,
            orderId: order._id.toString(),
            amount:
              Math.round(
                (Number(shopOrder.subtotal) || 0) * (1 - gpRate) * 100,
              ) / 100,
          });

          // Also emit to owner room as backup
          io.to(ownerId).emit("shop-payment-updated", {
            shopId,
            orderId: order._id.toString(),
            amount:
              Math.round(
                (Number(shopOrder.subtotal) || 0) * (1 - gpRate) * 100,
              ) / 100,
          });

          // Also emit update-status to owner for consistency
          const statusPayload = {
            orderId: order._id.toString(),
            readableOrderId: order.orderId || null,
            shopId: shopId,
            shopOrderId: shopOrder._id.toString(),
            status: "out of delivery",
            ownerId: ownerId,
          };

          io.to(ownerSocketId).emit("update-status", statusPayload);
          io.to(ownerId).emit("update-status", statusPayload);
        }
      }
    }

    res.status(200).json({ message: "Pickup confirmed successfully" });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Confirm pickup error:", error);
    res.status(500).json({ message: `confirm pickup error ${error}` });
  }
};

// Confirm arrival at customer location
export const confirmArrivalAtCustomer = async (req, res) => {
  try {
    const { orderId, shopOrderId } = req.body;
    if (!orderId || !shopOrderId) {
      return res
        .status(400)
        .json({ message: "orderId and shopOrderId are required" });
    }

    const order = await Order.findById(orderId).populate("user", "socketId");
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const shopOrder = order.shopOrders.find(
      (so) => so._id.toString() === shopOrderId,
    );

    if (!shopOrder) {
      return res.status(404).json({ message: "Shop order not found" });
    }

    // Update arrival time
    shopOrder.arrivedAtCustomerAt = new Date();
    await order.save();

    const io = req.app.get("io");
    if (io && order.user?._id) {
      io.to(order.user._id.toString()).emit("driver-arrived", {
        orderId: order._id.toString(),
        shopOrderId: shopOrder._id.toString(),
        arrivedAt: shopOrder.arrivedAtCustomerAt,
      });
      await emitOrderStatusUpdated(io, order._id);
    }

    res.status(200).json({ message: "Arrival confirmed successfully" });
  } catch (error) {
    res.status(500).json({ message: `confirm arrival error ${error}` });
  }
};

// Confirm delivery without OTP (replaces verifyDeliveryOtp for simplified flow)
export const confirmDelivery = async (req, res) => {
  try {
    const { orderId, shopOrderId } = req.body;
    if (!orderId || !shopOrderId) {
      return res
        .status(400)
        .json({ message: "orderId and shopOrderId are required" });
    }

    const order = await Order.findById(orderId)
      .populate("user", "socketId")
      .populate("shopOrders.owner", "socketId _id")
      .populate("shopOrders.assignedDeliveryBoy", "_id jobCredit");
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const shopOrder = order.shopOrders.find(
      (so) => so._id.toString() === shopOrderId,
    );

    if (!shopOrder) {
      return res.status(404).json({ message: "Shop order not found" });
    }

    // Idempotency: prevent double delivery processing when client retries
    if (String(shopOrder.status || "").toLowerCase() === "delivered") {
      return res.status(200).json({ message: "Delivery already confirmed" });
    }

    // Get commission rate for financial calculations
    const gpRate = await getGpRate();

    // Financial Calculation Logic (Per Order):
    // 1. Total Sales Value (Gross) = foodPrice + deliveryFee (tracked in analytics)
    // 2. Platform Income = foodPrice * (gpRate / 100)
    // 3. Shop Earnings = foodPrice - Platform Income (credit to shop wallet)
    // 4. Rider Earnings = deliveryFee (credit to rider wallet)

    const foodPrice = Number(shopOrder.subtotal) || 0;
    const deliveryFee = Number(order.deliveryFee) || 0;
    const platformIncome = Math.round(foodPrice * gpRate * 100) / 100;
    const shopEarnings = Math.round((foodPrice - platformIncome) * 100) / 100;

    // Credit shop wallet (only if not already credited - idempotency check)
    const shopId = shopOrder.shop?._id
      ? shopOrder.shop._id.toString()
      : shopOrder.shop?.toString();

    if (shopId && shopEarnings > 0) {
      const shop = await Shop.findById(shopId);
      if (shop) {
        // Check if wallet already credited for this order (idempotency)
        const alreadyCredited = Array.isArray(shop.payments)
          ? shop.payments.some(
              (p) =>
                p?.orderId &&
                p.orderId.toString() === order._id.toString() &&
                p.walletCredit,
            )
          : false;

        if (!alreadyCredited) {
          // Add wallet credit entry to payments array
          shop.payments.push({
            chargeId: `WALLET-${order._id}`,
            paymentIntentId: null,
            orderId: order._id,
            amount: shopEarnings,
            currency: "thb",
            status: "succeeded",
            receiptUrl: null,
            walletCredit: true, // Flag to indicate this is a wallet credit
            createdAt: new Date(),
          });
          await shop.save();

          console.log("Shop wallet credited on delivery:", {
            shopId,
            orderId: order._id.toString(),
            foodPrice,
            platformIncome,
            shopEarnings,
            gpRate,
          });
        }
      }
    }

    // Credit rider wallet (delivery fee) - ONLY for online payment methods
    // COD orders: Rider collects cash from customer, so no wallet credit needed
    const paymentMethod = String(order.paymentMethod || "").toLowerCase();
    const isOnlinePayment = ["online", "promptpay", "card"].includes(
      paymentMethod,
    );

    if (shopOrder.assignedDeliveryBoy && deliveryFee > 0 && isOnlinePayment) {
      const deliveryBoyId = shopOrder.assignedDeliveryBoy?._id
        ? shopOrder.assignedDeliveryBoy._id.toString()
        : shopOrder.assignedDeliveryBoy?.toString();

      if (deliveryBoyId) {
        // Check if wallet already credited for this order (idempotency)
        // We'll track this by checking if a payout exists for this order
        // For now, we'll add a wallet credit entry to user's payouts array
        const deliveryBoy = await User.findById(deliveryBoyId);
        if (deliveryBoy) {
          // Check if already credited (look for payout with this order reference)
          const alreadyCredited = Array.isArray(deliveryBoy.payouts)
            ? deliveryBoy.payouts.some(
                (p) =>
                  p?.orderId &&
                  p.orderId.toString() === order._id.toString() &&
                  p.source === "wallet" &&
                  p.type === "automatic",
              )
            : false;

          if (!alreadyCredited) {
            // Add wallet credit entry to payouts array
            deliveryBoy.payouts.push({
              payoutId: `WALLET-${order._id}-${Date.now()}`,
              amount: deliveryFee,
              currency: "thb",
              status: "paid", // Already "paid" since it's credited to wallet
              method: "standard",
              type: "automatic", // System-generated wallet credit
              source: "wallet",
              orderId: order._id, // Track which order this credit came from
              createdAt: new Date(),
            });
            await deliveryBoy.save();

            console.log("Rider wallet credited on delivery:", {
              deliveryBoyId,
              orderId: order._id.toString(),
              deliveryFee,
              paymentMethod: order.paymentMethod,
            });
          }
        }
      }
    } else if (paymentMethod === "cod") {
      console.log("COD order - wallet not credited (rider collects cash):", {
        orderId: order._id.toString(),
        deliveryFee,
      });
    }

    // Mark order as delivered
    shopOrder.status = "delivered";
    shopOrder.deliveredAt = new Date();
    await order.save();

    console.log("✅ Delivery confirmed:", {
      orderId: order._id.toString(),
      shopOrderId: shopOrder._id.toString(),
      deliveryBoyId:
        shopOrder.assignedDeliveryBoy?._id?.toString() ||
        shopOrder.assignedDeliveryBoy?.toString(),
      deliveredAt: shopOrder.deliveredAt,
      deliveryFee: order.deliveryFee,
      paymentMethod: order.paymentMethod,
    });

    const io = req.app.get("io");
    const socketMap = req.app.get("socketMap");

    if (io) {
      // Get owner ID (handle both populated and unpopulated cases)
      const ownerId = shopOrder.owner?._id
        ? shopOrder.owner._id.toString()
        : shopOrder.owner?.toString() || "";

      const socketMap = req.app.get("socketMap");
      const payload = {
        orderId: order._id.toString(),
        readableOrderId: order.orderId || null,
        shopId: shopOrder.shop?._id?.toString() || "",
        status: "delivered",
        userId: order.user?._id?.toString() || "",
        ownerId: ownerId,
        shopOrderId: shopOrder._id.toString(),
      };

      // Notify customer
      if (order.user?._id) {
        const userId = order.user._id.toString();
        const userSocketId =
          socketMap?.get(userId) || order.user?.socketId || userId;

        // Emit to specific socket ID (most reliable)
        io.to(userSocketId).emit("update-status", {
          ...payload,
          userId: userId,
        });

        // Also emit to user room as backup
        io.to(userId).emit("update-status", {
          ...payload,
          userId: userId,
        });
      }

      // Notify owner
      if (ownerId) {
        const ownerSocketId =
          socketMap?.get(ownerId) || shopOrder.owner?.socketId || ownerId;

        // Emit to specific socket ID (most reliable)
        io.to(ownerSocketId).emit("update-status", {
          ...payload,
          userId: order.user?._id?.toString() || "",
        });

        // Also emit to owner room as backup
        io.to(ownerId).emit("update-status", {
          ...payload,
          userId: order.user?._id?.toString() || "",
        });
      }

      // Notify delivery boy
      if (shopOrder.assignedDeliveryBoy) {
        const deliveryBoyId = shopOrder.assignedDeliveryBoy?._id
          ? shopOrder.assignedDeliveryBoy._id.toString()
          : shopOrder.assignedDeliveryBoy?.toString();

        if (deliveryBoyId) {
          const deliveryBoySocketId =
            socketMap?.get(deliveryBoyId) ||
            shopOrder.assignedDeliveryBoy?.socketId ||
            deliveryBoyId;

          // Emit to specific socket ID (most reliable)
          io.to(deliveryBoySocketId).emit("update-status", {
            ...payload,
            userId: order.user?._id?.toString() || "",
          });

          // Also emit to deliverer room as backup
          io.to(deliveryBoyId).emit("update-status", {
            ...payload,
            userId: order.user?._id?.toString() || "",
          });

          // Also emit updated credit in case it changed
          const deliveryBoy =
            await User.findById(deliveryBoyId).select("jobCredit");
          if (deliveryBoy) {
            io.to(deliveryBoySocketId).emit("job-credit-updated", {
              jobCredit: deliveryBoy.jobCredit,
            });
            io.to(deliveryBoyId).emit("job-credit-updated", {
              jobCredit: deliveryBoy.jobCredit,
            });
          }
        }
      }

      await emitOrderStatusUpdated(io, order._id);
    }

    res.status(200).json({ message: "Delivery confirmed successfully" });
  } catch (error) {
    res.status(500).json({ message: `confirm delivery error ${error}` });
  }
};

// Create Stripe payment intent
export const createPaymentIntent = async (req, res) => {
  try {
    const { totalAmount, orderId } = req.body;

    const systemSettings = await SystemSettings.findOne().select(
      "isSystemOpen maintenanceMode",
    );
    if (systemSettings) {
      if (
        systemSettings.maintenanceMode === true ||
        systemSettings.isSystemOpen === false
      ) {
        return res.status(503).json({
          message:
            "System is currently closed for maintenance. Please try again later.",
        });
      }
    }

    if (!orderId) {
      return res.status(400).json({ message: "Order ID is required" });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Enforce no customer surcharge: customer pays only food total + delivery fee.
    const enforcedTotal =
      Math.round(((Number(order.totalAmount) || 0) + 0) * 100) / 100;

    // Backwards compatibility: if a client still sends totalAmount, ignore it.
    if (!enforcedTotal || enforcedTotal <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    // Convert to cents (Stripe expects amounts in cents)
    const amountInCents = Math.round(enforcedTotal * 100);

    // Get user to check/create Stripe Customer ID
    const User = (await import("../models/user.model.js")).default;
    const user = await User.findById(req.userId);

    let stripeCustomerId = user.stripeCustomerId;

    // If user doesn't have a Stripe Customer ID, create one or find existing
    if (!stripeCustomerId) {
      try {
        // Check if customer exists in Stripe by email
        const existingCustomers = await stripe.customers.list({
          email: user.email,
          limit: 1,
        });

        if (existingCustomers.data.length > 0) {
          stripeCustomerId = existingCustomers.data[0].id;
        } else {
          // Create new customer
          const newCustomer = await stripe.customers.create({
            email: user.email,
            name: user.fullName,
            metadata: {
              userId: user._id.toString(),
            },
          });
          stripeCustomerId = newCustomer.id;
        }

        // Save to user profile
        user.stripeCustomerId = stripeCustomerId;
        await user.save();
        console.log("✅ Created/Linked Stripe Customer ID:", stripeCustomerId);
      } catch (customerError) {
        console.error("⚠️ Failed to create Stripe customer:", customerError);
        // Continue without customer ID (guest checkout)
      }
    }

    // Sync any local cards to Stripe if they haven't been synced yet
    // This bridges the gap for cards added via the "Add Card" screen
    if (stripeCustomerId && user.savedCards && user.savedCards.length > 0) {
      let cardsUpdated = false;
      for (const card of user.savedCards) {
        // Only sync if it has raw number (not masked) and no Stripe ID
        // Note: Raw numbers usually don't have spaces or asterisks if we cleaned them,
        // but let's check carefully. The AddCard controller stores them raw.
        const isRawNumber =
          card.cardNumber &&
          !card.cardNumber.includes("*") &&
          card.cardNumber.length >= 13;

        if (isRawNumber && !card.stripePaymentMethodId) {
          try {
            console.log("🔄 Syncing local card to Stripe:", card.last4);

            // Parse expiry
            const [exp_month_str, exp_year_str] = card.expiry.split("/");
            const exp_month = parseInt(exp_month_str.trim());
            let exp_year = parseInt(exp_year_str.trim());
            if (exp_year < 100) exp_year += 2000;

            // Create Payment Method
            const paymentMethod = await stripe.paymentMethods.create({
              type: "card",
              card: {
                number: card.cardNumber,
                exp_month,
                exp_year,
                cvc: card.cvv,
              },
              billing_details: {
                name: card.cardholderName || user.fullName,
                email: user.email,
              },
            });

            // Attach to Customer
            await stripe.paymentMethods.attach(paymentMethod.id, {
              customer: stripeCustomerId,
            });

            card.stripePaymentMethodId = paymentMethod.id;
            cardsUpdated = true;
            console.log("✅ Card synced successfully:", paymentMethod.id);
          } catch (syncError) {
            console.error(
              `⚠️ Failed to sync card ${card.last4}:`,
              syncError.message,
            );
          }
        }
      }

      if (cardsUpdated) {
        await user.save();
      }
    }

    // Determine payment method types based on request or default
    // If user explicitly chose 'promptpay' or 'card', we could restrict it,
    // but enabling both offers better UX if they change their mind on the Stripe page.
    // However, the prompt specifically asked: "if choose promtpay show promtpay. if choose card show card"
    // So we should respect the incoming paymentMethod if possible.

    // We don't have paymentMethod in the request body for this endpoint currently,
    // it usually comes from the order creation flow.
    // Let's check if we can get it from the order if not provided.
    let paymentMethodTypes = ["card", "promptpay"];

    // Check if order exists to see preferred method
    if (order && order.paymentMethod) {
      if (order.paymentMethod === "promptpay") {
        paymentMethodTypes = ["promptpay"];
      } else if (
        order.paymentMethod === "card" ||
        order.paymentMethod === "online"
      ) {
        paymentMethodTypes = ["card"];
      }
    }

    // Create Stripe Checkout Session configuration
    const sessionConfig = {
      payment_method_types: paymentMethodTypes,
      line_items: [
        {
          price_data: {
            currency: "thb",
            product_data: {
              name: `Order #${orderId}`,
              description: "Food delivery order payment",
            },
            unit_amount: amountInCents,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url:
        "http://localhost:5173/order-placed?session_id={CHECKOUT_SESSION_ID}",
      // Always redirect back to cart page on cancel, handling both new orders and retries there
      cancel_url: "http://localhost:5173/cart",
      metadata: {
        orderId: orderId,
        userId: req.userId,
      },
    };

    // If we have a customer ID, attach it to the session to save card info
    if (stripeCustomerId) {
      sessionConfig.customer = stripeCustomerId;
      // Enable saving payment method for future use
      // Note: 'setup_future_usage' is not compatible with all payment methods in checkout
      // For card, it works. For PromptPay, it might not be needed/supported in the same way.
      if (paymentMethodTypes.includes("card")) {
        sessionConfig.payment_intent_data = {
          setup_future_usage: "on_session",
        };
      }
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    console.log("Created Stripe Checkout Session:", {
      id: session.id,
      url: session.url,
      amount: amountInCents,
      customer: stripeCustomerId || "guest",
    });

    res.status(200).json({
      sessionId: session.id,
      url: session.url,
      orderId: orderId,
    });
  } catch (error) {
    console.error("Stripe checkout session error:", error);
    res
      .status(500)
      .json({ message: `Checkout session creation failed: ${error.message}` });
  }
};

// Verify payment and update order
export const verifyPayment = async (req, res) => {
  try {
    const { paymentIntentId, orderId } = req.body;

    if (!paymentIntentId || !orderId) {
      return res
        .status(400)
        .json({ message: "Payment intent ID and order ID are required" });
    }

    // Retrieve payment intent from Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== "succeeded") {
      return res.status(400).json({ message: "Payment not completed" });
    }

    // Find and update the order
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (order.user.toString() !== req.userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Update order with payment confirmation
    order.payment = true;
    order.stripePaymentId = paymentIntentId;
    await order.save();

    res.status(200).json({
      message: "Payment verified successfully",
      order: order,
    });
  } catch (error) {
    console.error("Payment verification error:", error);
    res
      .status(500)
      .json({ message: `Payment verification failed: ${error.message}` });
  }
};

// Stripe webhook handler
export const getOrderBySessionId = async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Find order by stripePaymentId (which contains the session ID)
    const order = await Order.findOne({ stripePaymentId: sessionId })
      .populate("user", "name email")
      .populate("shopOrders.shop", "name")
      .populate("shopOrders.owner", "name socketId")
      .populate("shopOrders.shopOrderItems.item", "name price");

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    res.status(200).json(order);
  } catch (error) {
    console.error("Error fetching order by session ID:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Helper to save card info from payment intent
const saveCardFromPaymentIntent = async (userId, paymentIntentId) => {
  try {
    if (!paymentIntentId) return;

    // Retrieve payment intent to get payment method
    const paymentIntent = await stripe.paymentIntents.retrieve(
      paymentIntentId,
      {
        expand: ["payment_method"],
      },
    );

    if (
      paymentIntent.status === "succeeded" &&
      paymentIntent.payment_method &&
      paymentIntent.payment_method.type === "card"
    ) {
      const cardInfo = paymentIntent.payment_method.card;
      const User = (await import("../models/user.model.js")).default;
      const user = await User.findById(userId);

      if (user) {
        // Check if card already exists
        const cardExists = user.savedCards.some(
          (c) =>
            c.last4 === cardInfo.last4 &&
            c.brand.toLowerCase() === cardInfo.brand.toLowerCase(),
        );

        if (!cardExists) {
          user.savedCards.push({
            cardNumber: `**** **** **** ${cardInfo.last4}`, // Masked
            cardName: "Card", // Default name
            expiryDate: `${cardInfo.exp_month}/${cardInfo.exp_year}`,
            cvv: "***",
            cardType: cardInfo.brand.toLowerCase(), // visa, mastercard
            last4: cardInfo.last4,
            isDefault: user.savedCards.length === 0, // Make default if first card
            brand: cardInfo.brand,
            stripePaymentMethodId: paymentIntent.payment_method.id,
          });
          await user.save();
          console.log("💳 Card saved to user profile:", cardInfo.last4);
        }
      }
    }
  } catch (error) {
    console.error("Error saving card info:", error);
  }
};

// Manual endpoint to update order payment status (for testing)
export const manualUpdatePayment = async (req, res) => {
  try {
    const { orderId, sessionId } = req.body;

    console.log("Manual payment update requested:", { orderId, sessionId });

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Update order with session ID and mark as paid
    order.stripePaymentId = sessionId;
    order.payment = true;
    await order.save();

    console.log("Order payment status manually updated:", {
      orderId: order._id,
      sessionId: sessionId,
      paymentStatus: order.payment,
    });

    // Try to save card info if session ID is provided
    if (sessionId) {
      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.payment_intent) {
          await saveCardFromPaymentIntent(order.user, session.payment_intent);
        }
      } catch (err) {
        console.error("Failed to retrieve session for card saving:", err);
      }
    }

    res.status(200).json({
      message: "Payment status updated successfully",
      order: order,
    });
  } catch (error) {
    console.error("Error manually updating payment:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Test endpoint without auth (for debugging)
export const testUpdatePayment = async (req, res) => {
  try {
    const { orderId, sessionId } = req.query;

    console.log("🧪 Test payment update requested:", { orderId, sessionId });

    if (!orderId || !sessionId) {
      return res.status(400).json({
        message: "Missing orderId or sessionId in query parameters",
      });
    }

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    console.log("📋 Order before update:", {
      id: order._id,
      stripePaymentId: order.stripePaymentId,
      payment: order.payment,
      paymentMethod: order.paymentMethod,
    });

    // Update order with session ID and mark as paid
    order.stripePaymentId = sessionId;
    order.payment = true;
    await order.save();

    console.log("✅ Order payment status updated:", {
      orderId: order._id,
      sessionId: sessionId,
      paymentStatus: order.payment,
    });

    res.status(200).json({
      message: "Payment status updated successfully",
      before: {
        stripePaymentId: "",
        payment: false,
      },
      after: {
        stripePaymentId: order.stripePaymentId,
        payment: order.payment,
      },
      order: order,
    });
  } catch (error) {
    console.error("❌ Error in test update payment:", error);
    res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
};

// Test endpoint for session update
export const testSessionUpdate = async (req, res) => {
  console.log("🧪 Test session update endpoint called");
  console.log("Request body:", req.body);
  res.status(200).json({
    message: "Session update endpoint is working!",
    body: req.body,
    timestamp: new Date().toISOString(),
  });
};

// Update payment status by Stripe session ID
export const updatePaymentBySessionId = async (req, res) => {
  try {
    const { sessionId } = req.body;

    console.log("🔄 Updating payment by session ID:", sessionId);

    if (!sessionId) {
      return res.status(400).json({
        message: "Session ID is required",
        success: false,
      });
    }

    // First check if order already has this session ID
    let order = await Order.findOne({ stripePaymentId: sessionId });

    if (order) {
      console.log("✅ Order already updated with this session ID");
      return res.status(200).json({
        message: "Order already updated",
        order: order,
        success: true,
      });
    }

    // Find order by checking recent online orders that aren't paid yet
    // We'll find the most recent unpaid online order for this session
    const recentOrders = await Order.find({
      paymentMethod: { $in: ["online", "promptpay", "card"] },
      payment: false,
      createdAt: { $gte: new Date(Date.now() - 10 * 60 * 1000) }, // Last 10 minutes
    })
      .sort({ createdAt: -1 })
      .limit(5);

    if (recentOrders.length === 0) {
      console.log("⚠️ No recent unpaid online orders found");
      return res.status(404).json({
        message: "No recent unpaid orders found",
        success: false,
      });
    }

    // Take the most recent unpaid order
    order = recentOrders[0];

    // Update with session ID and mark as paid
    order.stripePaymentId = sessionId;
    order.payment = true;
    await order.save();

    console.log("✅ Payment updated by session ID:", {
      orderId: order._id,
      sessionId: sessionId,
      paymentStatus: order.payment,
      orderAmount: order.totalAmount,
    });

    res.status(200).json({
      message: "Payment status updated successfully",
      order: order,
      success: true,
    });
  } catch (error) {
    console.error("❌ Error updating payment by session ID:", error);
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
      success: false,
    });
  }
};

// Auto-update payment status for development (simulates webhook)
export const autoUpdatePayment = async (req, res) => {
  try {
    const { orderId } = req.body;

    console.log("🤖 Auto-updating payment status for order:", orderId);

    if (!orderId) {
      return res.status(400).json({ message: "Order ID is required" });
    }

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Only update if payment is still false
    if (!order.payment) {
      // Additional validation: only update online payments
      if (!["online", "promptpay", "card"].includes(order.paymentMethod)) {
        console.log("⚠️ Order is not an online payment:", order.paymentMethod);
        return res.status(400).json({
          message: "Order is not an online payment",
          paymentMethod: order.paymentMethod,
          success: false,
        });
      }

      // Generate a session ID that looks like a real Stripe session
      const sessionId = `cs_auto_${Date.now()}_${orderId.slice(-6)}`;

      order.stripePaymentId = sessionId;
      order.payment = true;
      await order.save();

      console.log("✅ Payment status auto-updated:", {
        orderId: order._id,
        sessionId: sessionId,
        paymentStatus: order.payment,
        paymentMethod: order.paymentMethod,
      });

      res.status(200).json({
        message: "Payment status updated automatically",
        order: order,
        sessionId: sessionId,
        success: true,
      });
    } else {
      console.log("ℹ️ Order already paid");
      res.status(200).json({
        message: "Order already paid",
        order: order,
        success: true,
      });
    }
  } catch (error) {
    console.error("❌ Error auto-updating payment:", error);
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
      success: false,
    });
  }
};

export const handleStripeWebhook = async (req, res) => {
  console.log("🔔 Stripe webhook received!");
  console.log("📋 Request details:", {
    method: req.method,
    url: req.url,
    headers: Object.keys(req.headers),
    hasStripeSignature: !!req.headers["stripe-signature"],
    bodyType: typeof req.body,
    bodyLength: req.body?.length,
    timestamp: new Date().toISOString(),
  });

  const sig = req.headers["stripe-signature"];
  let event;

  // Check if webhook secret is configured
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error("❌ STRIPE_WEBHOOK_SECRET not configured!");
    console.log("💡 Add STRIPE_WEBHOOK_SECRET to your .env file");
    return res.status(500).send("Webhook secret not configured");
  }

  console.log(
    "🔑 Webhook secret configured:",
    process.env.STRIPE_WEBHOOK_SECRET.substring(0, 10) + "...",
  );

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
    console.log("✅ Webhook signature verified successfully");
  } catch (err) {
    console.error("❌ Webhook signature verification failed:", err.message);
    console.error("🔍 Debug info:", {
      expectedSignature: sig,
      webhookSecretExists: !!process.env.STRIPE_WEBHOOK_SECRET,
      bodyType: typeof req.body,
      bodyLength: req.body?.length,
    });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log("🎯 Received Stripe webhook event:", event.type);
  console.log("📊 Event data:", {
    id: event.id,
    type: event.type,
    created: event.created,
    livemode: event.livemode,
  });

  // Handle the event
  switch (event.type) {
    case "checkout.session.completed":
      const session = event.data.object;
      console.log("Checkout session completed:", {
        id: session.id,
        payment_status: session.payment_status,
        metadata: session.metadata,
      });

      try {
        // Check if this is a credit top-up payment
        if (session.metadata?.type === "credit_topup") {
          const User = (await import("../models/user.model.js")).default;
          const userId = session.metadata.userId;
          const topUpAmount = parseFloat(session.metadata.amount);

          // Use $inc to ensure atomic operation and prevent double counting
          const user = await User.findByIdAndUpdate(
            userId,
            { $inc: { jobCredit: topUpAmount } },
            { new: true },
          );

          if (user) {
            console.log("Credit top-up completed via webhook:", {
              userId: userId,
              sessionId: session.id,
              topUpAmount: topUpAmount,
              newCredit: user.jobCredit,
            });

            // Emit socket event to update credit in real time
            const io = req.app.get("io");
            const socketMap = req.app.get("socketMap");
            if (io) {
              const userSocketId =
                socketMap?.get(userId?.toString()) || user?.socketId;
              if (userSocketId) {
                io.to(userSocketId).emit("job-credit-updated", {
                  jobCredit: user.jobCredit,
                });
              }
            }
          } else {
            console.error("User not found for credit top-up:", userId);
          }
        } else {
          // Find order by orderId in metadata
          const order = await Order.findById(session.metadata?.orderId);

          if (order) {
            // Update order with session ID and mark as paid
            order.stripePaymentId = session.id;
            order.payment = true;
            await order.save();

            console.log("Order payment status updated:", {
              orderId: order._id,
              sessionId: session.id,
              paymentStatus: order.payment,
              orderAmount: order.totalAmount,
            });
          } else {
            console.log("No order found for session:", {
              sessionId: session.id,
              metadataOrderId: session.metadata?.orderId,
            });
          }
        }
      } catch (error) {
        console.error("Error updating payment status:", error);
      }
      break;

    case "payment_intent.succeeded":
      const paymentIntent = event.data.object;
      console.log("PaymentIntent succeeded:", {
        id: paymentIntent.id,
        amount: paymentIntent.amount,
        status: paymentIntent.status,
        metadata: paymentIntent.metadata,
      });

      // Update order status if needed
      try {
        // First try to find by stripePaymentId
        let order = await Order.findOne({
          stripePaymentId: paymentIntent.id,
        });

        // If not found, try to find by orderId in metadata
        if (!order && paymentIntent.metadata?.orderId) {
          order = await Order.findById(paymentIntent.metadata.orderId);
          if (order) {
            // Update the stripePaymentId if it was missing
            order.stripePaymentId = paymentIntent.id;
            console.log("Updated order with correct stripePaymentId:", {
              orderId: order._id,
              stripePaymentId: paymentIntent.id,
            });
          }
        }

        if (order) {
          if (!order.payment) {
            order.payment = true;
            await order.save();
            console.log("Order payment status updated:", {
              orderId: order._id,
              paymentIntentId: paymentIntent.id,
              paymentStatus: order.payment,
              orderAmount: order.totalAmount,
              stripeAmount: paymentIntent.amount,
            });
          } else {
            console.log("Order already marked as paid:", order._id);
          }
        } else {
          console.log("No order found for payment intent:", {
            stripePaymentId: paymentIntent.id,
            metadataOrderId: paymentIntent.metadata?.orderId,
          });
        }
      } catch (error) {
        console.error("Error updating order payment status:", error);
      }
      break;

    case "payment_intent.payment_failed":
      const failedPayment = event.data.object;
      console.log("PaymentIntent failed:", {
        id: failedPayment.id,
        status: failedPayment.status,
        last_payment_error: failedPayment.last_payment_error,
      });
      break;

    case "payment_intent.created":
      const createdPaymentIntent = event.data.object;
      console.log("PaymentIntent created:", {
        id: createdPaymentIntent.id,
        status: createdPaymentIntent.status,
        metadata: createdPaymentIntent.metadata,
      });
      break;

    case "charge.succeeded":
      const charge = event.data.object;
      console.log("Charge succeeded:", {
        id: charge.id,
        amount: charge.amount,
        currency: charge.currency,
        payment_intent: charge.payment_intent,
        status: charge.status,
      });

      try {
        // Find order by payment intent ID
        let order = null;
        if (charge.payment_intent) {
          order = await Order.findOne({
            stripePaymentId: charge.payment_intent,
          }).populate("shopOrders.shop");
        }

        // If not found, try to find by orderId in metadata (if available)
        if (!order && charge.metadata?.orderId) {
          order = await Order.findById(charge.metadata.orderId).populate(
            "shopOrders.shop",
          );
        }

        // Do NOT credit restaurant wallets here.
        // Stripe charge amount includes delivery fees and should not bypass GP deduction.
        // Restaurant credit is recorded as NET (after GP) in confirmDelivery.
        if (!order) {
          console.log("No order or shop found for charge:", {
            chargeId: charge.id,
            paymentIntentId: charge.payment_intent,
            metadataOrderId: charge.metadata?.orderId,
          });
        }
      } catch (error) {
        console.error("Error processing charge.succeeded event:", error);
      }
      break;

    case "payout.created":
      const payout = event.data.object;
      console.log("Payout created:", {
        id: payout.id,
        amount: payout.amount,
        currency: payout.currency,
        status: payout.status,
        automatic: payout.automatic,
        arrival_date: payout.arrival_date,
        metadata: payout.metadata,
        destination: payout.destination,
      });

      try {
        // Find shop by shopId in metadata (if available)
        let shop = null;
        if (payout.metadata?.shopId) {
          shop = await Shop.findById(payout.metadata.shopId);
        }

        // If not found in metadata, try to find by bank account destination
        if (!shop && payout.destination) {
          // Try to find shop by stripeBankAccountId (the destination is the bank account ID)
          shop = await Shop.findOne({
            stripeBankAccountId: payout.destination,
          });
        }

        if (shop) {
          // Check if this payout already exists
          const existingPayout = shop.payouts?.find(
            (p) => p.payoutId === payout.id,
          );

          if (!existingPayout) {
            // Convert amount from cents to THB
            const amountInTHB = payout.amount / 100;

            // Determine if this is an automatic or manual payout
            // Stripe's payout object has an `automatic` property
            const isAutomatic = payout.automatic === true;

            // Add payout record to shop
            if (!shop.payouts) {
              shop.payouts = [];
            }

            shop.payouts.push({
              payoutId: payout.id,
              amount: amountInTHB,
              currency: payout.currency,
              status: payout.status,
              method: payout.method || "standard",
              type: isAutomatic ? "automatic" : "manual",
              arrivalDate: payout.arrival_date
                ? new Date(payout.arrival_date * 1000)
                : null,
              createdAt: new Date(payout.created * 1000),
            });

            await shop.save();
            console.log("Payout record added to shop:", {
              shopId: shop._id,
              payoutId: payout.id,
              amount: amountInTHB,
              type: isAutomatic ? "automatic" : "manual",
              status: payout.status,
            });
          } else {
            console.log("Payout record already exists:", payout.id);
          }
        } else {
          console.log("No shop found for payout:", {
            payoutId: payout.id,
            metadataShopId: payout.metadata?.shopId,
            automatic: payout.automatic,
          });
        }
      } catch (error) {
        console.error("Error processing payout.created event:", error);
      }
      break;

    case "payout.paid":
      const paidPayout = event.data.object;
      console.log("Payout paid:", {
        id: paidPayout.id,
        status: paidPayout.status,
        metadata: paidPayout.metadata,
      });

      try {
        // Check if this is a delivery boy withdrawal
        if (
          paidPayout.metadata?.withdrawalType === "delivery_boy_withdrawal" &&
          paidPayout.metadata?.userId
        ) {
          const userId = paidPayout.metadata.userId;

          const user = await User.findById(userId);
          if (user && user.payouts) {
            const payoutIndex = user.payouts.findIndex(
              (p) => p.payoutId === paidPayout.id,
            );
            if (payoutIndex !== -1) {
              user.payouts[payoutIndex].status = "paid";
              await user.save();
              console.log(
                "Delivery boy payout status updated to paid:",
                paidPayout.id,
              );
            } else {
              console.log(
                "Payout not found in user's payout history:",
                paidPayout.id,
              );
            }
          }
        } else {
          // Handle shop payout (existing logic)
          let shop = null;

          // Try to find shop by metadata first
          if (paidPayout.metadata?.shopId) {
            shop = await Shop.findById(paidPayout.metadata.shopId);
          }

          // If not found, try to match by destination (bank account ID)
          if (!shop && paidPayout.destination) {
            shop = await Shop.findOne({
              stripeBankAccountId: paidPayout.destination,
            });
          }

          if (shop && shop.payouts) {
            const payoutIndex = shop.payouts.findIndex(
              (p) => p.payoutId === paidPayout.id,
            );
            if (payoutIndex !== -1) {
              shop.payouts[payoutIndex].status = "paid";
              await shop.save();
              console.log("Shop payout status updated to paid:", paidPayout.id);
            }
          }
        }
      } catch (error) {
        console.error("Error processing payout.paid event:", error);
      }
      break;

    case "payout.failed":
      const failedPayout = event.data.object;
      console.log("Payout failed:", {
        id: failedPayout.id,
        status: failedPayout.status,
        failure_code: failedPayout.failure_code,
        failure_message: failedPayout.failure_message,
        metadata: failedPayout.metadata,
      });

      try {
        // Check if this is a delivery boy withdrawal
        if (
          failedPayout.metadata?.withdrawalType === "delivery_boy_withdrawal" &&
          failedPayout.metadata?.userId
        ) {
          const userId = failedPayout.metadata.userId;

          const user = await User.findById(userId);
          if (user && user.payouts) {
            const payoutIndex = user.payouts.findIndex(
              (p) => p.payoutId === failedPayout.id,
            );
            if (payoutIndex !== -1) {
              user.payouts[payoutIndex].status = "failed";
              // If payout failed, we should restore the job credit that was deducted
              // The amount that was deducted from credit should be restored
              const payoutAmount = user.payouts[payoutIndex].amount || 0;
              // Calculate how much was deducted from credit (if any)
              // This is complex, so for now we'll just update the status
              // The credit restoration logic can be added if needed
              await user.save();
              console.log(
                "Delivery boy payout status updated to failed:",
                failedPayout.id,
              );
            }
          }
        } else {
          // Handle shop payout (existing logic)
          let shop = null;

          // Try to find shop by metadata first
          if (failedPayout.metadata?.shopId) {
            shop = await Shop.findById(failedPayout.metadata.shopId);
          }

          // If not found, try to match by destination (bank account ID)
          if (!shop && failedPayout.destination) {
            shop = await Shop.findOne({
              stripeBankAccountId: failedPayout.destination,
            });
          }

          if (shop && shop.payouts) {
            const payoutIndex = shop.payouts.findIndex(
              (p) => p.payoutId === failedPayout.id,
            );
            if (payoutIndex !== -1) {
              shop.payouts[payoutIndex].status = "failed";
              await shop.save();
              console.log(
                "Shop payout status updated to failed:",
                failedPayout.id,
              );
            }
          }
        }
      } catch (error) {
        console.error("Error processing payout.failed event:", error);
      }
      break;

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.status(200).json({ received: true });
};

// Update order with payment intent ID
export const updateOrderWithPaymentIntent = async (req, res) => {
  try {
    const { orderId, stripePaymentId } = req.body;

    if (!orderId || !stripePaymentId) {
      return res.status(400).json({
        message: "Order ID and Stripe Payment ID are required",
      });
    }

    // Verify the payment intent exists in Stripe
    try {
      const paymentIntent =
        await stripe.paymentIntents.retrieve(stripePaymentId);
      console.log("Verified Stripe Payment Intent:", {
        id: paymentIntent.id,
        status: paymentIntent.status,
        amount: paymentIntent.amount,
        metadata: paymentIntent.metadata,
      });
    } catch (stripeError) {
      console.error("Invalid Stripe Payment Intent ID:", stripeError.message);
      return res.status(400).json({
        message: "Invalid Stripe Payment Intent ID",
      });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (order.user.toString() !== req.userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    order.stripePaymentId = stripePaymentId;
    order.payment = true; // Set payment to true when stripePaymentId is assigned
    await order.save();

    console.log("Order updated with payment intent:", {
      orderId: order._id,
      stripePaymentId: stripePaymentId,
      paymentStatus: order.payment,
    });

    res.status(200).json({
      message: "Order updated with payment intent ID",
      order: order,
    });
  } catch (error) {
    console.error("Error updating order with payment intent:", error);
    res.status(500).json({
      message: `Error updating order: ${error.message}`,
    });
  }
};

// Admin endpoint to fix specific order payment status
export const adminFixPayment = async (req, res) => {
  try {
    const { orderId } = req.params;

    console.log("🔧 Admin fixing payment for order:", orderId);

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    console.log("📊 Current order status:", {
      payment: order.payment,
      stripePaymentId: order.stripePaymentId,
      totalAmount: order.totalAmount,
    });

    if (!order.stripePaymentId) {
      return res.status(400).json({ message: "No Stripe payment ID found" });
    }

    // If stripePaymentId exists, set payment to true automatically
    if (order.stripePaymentId && !order.payment) {
      order.payment = true;
      await order.save();

      console.log("✅ Payment status set to true (stripePaymentId exists)");

      return res.status(200).json({
        message: "Payment status set to true (stripePaymentId exists)",
        order: {
          _id: order._id,
          payment: order.payment,
          stripePaymentId: order.stripePaymentId,
          totalAmount: order.totalAmount,
        },
      });
    }

    // If already paid, just return current status
    return res.status(200).json({
      message: "Order already marked as paid",
      order: {
        _id: order._id,
        payment: order.payment,
        stripePaymentId: order.stripePaymentId,
        totalAmount: order.totalAmount,
      },
    });
  } catch (error) {
    console.error("❌ Error fixing payment:", error);
    res.status(500).json({
      message: `Error fixing payment: ${error.message}`,
    });
  }
};

// Manual fix for payment status mismatch
export const fixPaymentStatus = async (req, res) => {
  try {
    const { orderId, stripePaymentId } = req.body;

    if (!orderId) {
      return res.status(400).json({ message: "Order ID is required" });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (order.user.toString() !== req.userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // If stripePaymentId is provided, verify it exists in Stripe
    if (stripePaymentId) {
      try {
        const paymentIntent =
          await stripe.paymentIntents.retrieve(stripePaymentId);
        console.log("Retrieved payment intent:", {
          id: paymentIntent.id,
          status: paymentIntent.status,
          amount: paymentIntent.amount,
          metadata: paymentIntent.metadata,
        });

        if (paymentIntent.status === "succeeded") {
          order.payment = true;
          order.stripePaymentId = stripePaymentId;
          await order.save();

          return res.status(200).json({
            message: "Payment status fixed successfully",
            order: {
              _id: order._id,
              payment: order.payment,
              stripePaymentId: order.stripePaymentId,
              totalAmount: order.totalAmount,
            },
            stripePaymentIntent: {
              id: paymentIntent.id,
              status: paymentIntent.status,
              amount: paymentIntent.amount,
            },
          });
        } else {
          return res.status(400).json({
            message: `Payment intent status is ${paymentIntent.status}, not succeeded`,
          });
        }
      } catch (stripeError) {
        console.error("Error retrieving payment intent:", stripeError.message);
        return res.status(400).json({
          message: "Invalid Stripe Payment Intent ID",
        });
      }
    } else {
      // Just return current order status
      return res.status(200).json({
        order: {
          _id: order._id,
          payment: order.payment,
          stripePaymentId: order.stripePaymentId,
          totalAmount: order.totalAmount,
        },
      });
    }
  } catch (error) {
    console.error("Error fixing payment status:", error);
    res.status(500).json({
      message: `Error fixing payment status: ${error.message}`,
    });
  }
};

// Test endpoint to check order payment status
export const checkOrderPaymentStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    let stripePaymentIntentDetails = null;

    // If there's a stripe payment ID, get details from Stripe
    if (order.stripePaymentId) {
      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(
          order.stripePaymentId,
        );
        stripePaymentIntentDetails = {
          id: paymentIntent.id,
          status: paymentIntent.status,
          amount: paymentIntent.amount,
          currency: paymentIntent.currency,
          created: paymentIntent.created,
          metadata: paymentIntent.metadata,
        };
      } catch (stripeError) {
        console.error(
          "Error retrieving Stripe payment intent:",
          stripeError.message,
        );
        stripePaymentIntentDetails = {
          error: "Failed to retrieve from Stripe",
        };
      }
    }

    res.status(200).json({
      orderId: order._id,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.payment,
      stripePaymentId: order.stripePaymentId,
      totalAmount: order.totalAmount,
      stripePaymentIntentDetails: stripePaymentIntentDetails,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: `Error checking order status: ${error.message}` });
  }
};

export const getTodayDeliveries = async (req, res) => {
  try {
    const deliveryBoyId = req.userId;
    let startsOfDay;

    if (req.query.date) {
      startsOfDay = new Date(req.query.date);
    } else {
      startsOfDay = new Date();
      startsOfDay.setHours(0, 0, 0, 0);
    }

    // Use $elemMatch to ensure all conditions apply to the same shopOrder
    // Also convert deliveredAt to Date for proper comparison
    const endOfDay = new Date(startsOfDay);
    endOfDay.setHours(23, 59, 59, 999);

    // Query with $elemMatch - MongoDB will match ObjectId with string automatically
    // But we need to handle both cases in the query
    const deliveryBoyObjectId = mongoose.Types.ObjectId.isValid(deliveryBoyId)
      ? new mongoose.Types.ObjectId(deliveryBoyId)
      : deliveryBoyId;

    const orders = await Order.find({
      shopOrders: {
        $elemMatch: {
          $or: [
            { assignedDeliveryBoy: deliveryBoyObjectId },
            { assignedDeliveryBoy: deliveryBoyId },
          ],
          status: "delivered",
          deliveredAt: { $gte: startsOfDay, $lte: endOfDay },
        },
      },
      // Include all payment methods (COD, online, promptpay, card)
    }).lean();

    console.log(
      `🔍 getTodayDeliveries: Found ${orders.length} orders for delivery boy ${deliveryBoyId}`,
    );
    console.log(
      `📅 Date range: ${startsOfDay.toISOString()} to ${endOfDay.toISOString()}`,
    );

    // If no orders found, try a simpler query to see if there are any delivered orders at all
    if (orders.length === 0) {
      const allDeliveredOrders = await Order.find({
        "shopOrders.assignedDeliveryBoy": deliveryBoyId,
        "shopOrders.status": "delivered",
        // Include all payment methods
      }).lean();
      console.log(
        `⚠️ No orders found with date filter. Found ${allDeliveredOrders.length} total delivered orders (any date)`,
      );
      if (allDeliveredOrders.length > 0) {
        const deliveryBoyIdStr = deliveryBoyId.toString();
        allDeliveredOrders.forEach((order) => {
          order.shopOrders.forEach((so) => {
            const assignedId = so.assignedDeliveryBoy?.toString();
            if (assignedId === deliveryBoyIdStr && so.status === "delivered") {
              const deliveredAt = so.deliveredAt
                ? new Date(so.deliveredAt)
                : null;
              const isToday =
                deliveredAt &&
                deliveredAt >= startsOfDay &&
                deliveredAt <= endOfDay;
              console.log(
                `  - Order ${order._id}: deliveredAt=${deliveredAt?.toISOString()}, isToday=${isToday}, deliveryFee=${order.deliveryFee}`,
              );
            }
          });
        });
      }
    }

    let todaysDeliveries = [];
    let totalDeliveryFee = 0;
    const processedOrderIds = new Set(); // Track which orders we've already counted delivery fee for

    const deliveryBoyIdStr = deliveryBoyId.toString();

    orders.forEach((order) => {
      let orderProcessed = false;
      console.log(
        `📦 Processing order ${order._id}, paymentMethod: ${order.paymentMethod}, deliveryFee: ${order.deliveryFee}`,
      );

      order.shopOrders.forEach((shopOrder) => {
        // Convert deliveredAt to Date if it's a string or ObjectId timestamp
        const deliveredAtDate = shopOrder.deliveredAt
          ? new Date(shopOrder.deliveredAt)
          : null;

        // Handle both ObjectId and string comparisons - in lean() mode, it's usually a string/ObjectId
        const assignedId = shopOrder.assignedDeliveryBoy
          ? typeof shopOrder.assignedDeliveryBoy === "object"
            ? shopOrder.assignedDeliveryBoy._id?.toString() ||
              shopOrder.assignedDeliveryBoy.toString()
            : shopOrder.assignedDeliveryBoy.toString()
          : null;

        console.log(
          `  - ShopOrder ${shopOrder._id}: assignedId=${assignedId}, status=${shopOrder.status}, deliveredAt=${deliveredAtDate}`,
        );

        if (
          assignedId &&
          assignedId.toString() === deliveryBoyIdStr &&
          shopOrder.status === "delivered" &&
          deliveredAtDate &&
          deliveredAtDate >= startsOfDay &&
          deliveredAtDate <= endOfDay
        ) {
          todaysDeliveries.push(shopOrder);
          // Add delivery fee from the order only once per order (not per shopOrder)
          if (!orderProcessed && !processedOrderIds.has(order._id.toString())) {
            const orderFee = Number(order.deliveryFee) || 0;
            totalDeliveryFee += orderFee;
            console.log(
              `💰 Adding delivery fee ${orderFee} from order ${order._id} (deliveredAt: ${deliveredAtDate.toISOString()}, total: ${totalDeliveryFee})`,
            );
            processedOrderIds.add(order._id.toString());
            orderProcessed = true;
          }
        }
      });
    });

    console.log(
      `✅ getTodayDeliveries: Total delivery fee for today: ${totalDeliveryFee}`,
    );

    let stats = {};
    todaysDeliveries.forEach((shopOrder) => {
      const hour = new Date(shopOrder.deliveredAt).getHours();
      stats[hour] = (stats[hour] || 0) + 1;
    });

    let formattedStats = Object.keys(stats).map((hour) => ({
      hour: parseInt(hour),
      count: stats[hour],
    }));

    formattedStats.sort((a, b) => a.hour - b.hour);

    // Return stats with total delivery fee
    return res.status(200).json({
      stats: formattedStats,
      totalDeliveryFee: totalDeliveryFee,
    });
  } catch (error) {
    return res.status(500).json({ message: `today deliveries error ${error}` });
  }
};

export const updateOrderItems = async (req, res) => {
  try {
    const { orderId, shopId } = req.params;
    const { shopOrderItems, subtotal } = req.body;

    if (!orderId || !shopId) {
      return res
        .status(400)
        .json({ message: "Order ID and Shop ID are required" });
    }

    if (
      !shopOrderItems ||
      !Array.isArray(shopOrderItems) ||
      shopOrderItems.length === 0
    ) {
      return res.status(400).json({ message: "Order items are required" });
    }

    const order = await Order.findById(orderId)
      .populate("user", "socketId")
      .populate("shopOrders.shop", "name");

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Find shopOrder by matching shop ID
    const shopOrder = order.shopOrders.find((so) => {
      const shopIdValue = so.shop?._id
        ? so.shop._id.toString()
        : so.shop?.toString();
      return shopIdValue === shopId;
    });

    if (!shopOrder) {
      return res.status(404).json({ message: "Shop order not found" });
    }

    // Verify the order belongs to the authenticated owner
    const ownerId = shopOrder.owner?._id
      ? shopOrder.owner._id.toString()
      : shopOrder.owner?.toString();

    if (ownerId !== req.userId) {
      return res.status(403).json({
        message: "Unauthorized. You can only edit your own shop orders.",
      });
    }

    // Only allow editing if order is still pending
    if (shopOrder.status !== "pending") {
      return res.status(400).json({
        message: `Cannot edit order. Order status is: ${shopOrder.status}`,
      });
    }

    // Update shop order items and subtotal
    shopOrder.shopOrderItems = shopOrderItems;
    shopOrder.subtotal =
      subtotal ||
      shopOrderItems.reduce(
        (sum, item) => sum + (item.price || 0) * (item.quantity || 0),
        0,
      );

    // Update order total amount (subtotal only, no tax)
    order.totalAmount = shopOrder.subtotal;

    await order.save();

    const io = req.app.get("io");

    // Notify customer about order update
    if (io && order.user?.socketId) {
      const shopIdForEmit =
        shopOrder.shop && shopOrder.shop._id
          ? shopOrder.shop._id.toString()
          : shopOrder.shop?.toString();

      io.to(order.user.socketId).emit("order-updated", {
        orderId: order._id,
        shopId: shopIdForEmit,
        userId: order.user._id,
      });
    }

    res.status(200).json({
      message: "Order items updated successfully",
      order: {
        _id: order._id,
        shopOrder: {
          _id: shopOrder._id,
          shopOrderItems: shopOrder.shopOrderItems,
          subtotal: shopOrder.subtotal,
        },
        totalAmount: order.totalAmount,
      },
    });
  } catch (error) {
    console.error("Update order items error:", error);
    res
      .status(500)
      .json({ message: `Update order items error: ${error.message}` });
  }
};

export const getCancellationCount = async (req, res) => {
  try {
    // Calculate start of current week (Monday 00:00:00)
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Days to subtract to get to Monday
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - daysToMonday);
    startOfWeek.setHours(0, 0, 0, 0);
    startOfWeek.setMilliseconds(0);

    // Find all orders for this owner (MongoDB doesn't support nested array queries directly)
    const orders = await Order.find({
      "shopOrders.owner": req.userId,
    }).lean();

    let cancellationCount = 0;
    orders.forEach((order) => {
      order.shopOrders.forEach((shopOrder) => {
        const ownerId = shopOrder.owner?.toString();
        if (
          ownerId === req.userId.toString() &&
          shopOrder.status === "cancelled" &&
          shopOrder.cancelledAt
        ) {
          const cancelledAt = new Date(shopOrder.cancelledAt);
          if (cancelledAt >= startOfWeek) {
            cancellationCount++;
          }
        }
      });
    });

    return res.status(200).json({ count: cancellationCount, maxCount: 7 });
  } catch (error) {
    console.error("Get cancellation count error:", error);
    return res
      .status(500)
      .json({ message: `Get cancellation count error: ${error.message}` });
  }
};

export const cancelShopOrder = async (req, res) => {
  try {
    const { orderId, shopId } = req.params;
    const { reason } = req.body;

    if (!orderId || !shopId) {
      return res
        .status(400)
        .json({ message: "Order ID and Shop ID are required" });
    }

    if (!reason || !reason.trim()) {
      return res.status(400).json({ message: "Cancel reason is required" });
    }

    const order = await Order.findById(orderId)
      .populate("user", "socketId fullName email")
      .populate("shopOrders.owner", "socketId _id")
      .populate("shopOrders.assignedDeliveryBoy", "socketId _id")
      .populate("shopOrders.shop", "name");

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Find shopOrder by matching shop ID
    const shopOrder = order.shopOrders.find((so) => {
      const shopIdValue = so.shop?._id
        ? so.shop._id.toString()
        : so.shop?.toString();
      return shopIdValue === shopId;
    });

    if (!shopOrder) {
      return res.status(404).json({ message: "Shop order not found" });
    }

    // Get user role to determine authorization
    const user = await User.findById(req.userId).select("role");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const ownerId = shopOrder.owner?._id
      ? shopOrder.owner._id.toString()
      : shopOrder.owner?.toString();
    const userId = order.user?._id
      ? order.user._id.toString()
      : order.user?.toString();
    const assignedDeliveryBoyId = shopOrder.assignedDeliveryBoy?._id
      ? shopOrder.assignedDeliveryBoy._id.toString()
      : shopOrder.assignedDeliveryBoy?.toString();

    // Check authorization: User can cancel their own order, Owner can cancel their shop order, Deliverer can cancel assigned order
    const isAuthorized =
      user.role === "user" && userId === req.userId.toString()
        ? true
        : user.role === "owner" && ownerId === req.userId.toString()
          ? true
          : (user.role === "deliveryBoy" || user.role === "delivery") &&
              assignedDeliveryBoyId === req.userId.toString()
            ? true
            : false;

    if (!isAuthorized) {
      return res.status(403).json({
        message:
          "Unauthorized. You can only cancel orders you own, manage, or are assigned to deliver.",
      });
    }

    // Determine allowed statuses based on who is cancelling
    let allowedStatuses = [];
    if (user.role === "user") {
      // Users can cancel if order is pending, preparing, or out of delivery (before pickup)
      allowedStatuses = [
        "pending",
        "preparing",
        "out of delivery",
        "out_for_delivery",
      ];
    } else if (user.role === "owner") {
      // Owners can cancel if order is pending or preparing
      allowedStatuses = ["pending", "preparing"];
    } else if (user.role === "deliveryBoy" || user.role === "delivery") {
      // Deliverers can cancel if order is out of delivery (they're assigned)
      allowedStatuses = ["out of delivery", "out_for_delivery"];
    }

    if (!allowedStatuses.includes(shopOrder.status)) {
      return res.status(400).json({
        message: `Cannot cancel order. Order status is: ${shopOrder.status}. Only orders with status ${allowedStatuses.join(", ")} can be cancelled.`,
      });
    }

    // Check if order was already picked up (deliverers can't cancel after pickup)
    if (
      (user.role === "deliveryBoy" || user.role === "delivery") &&
      shopOrder.pickedUpAt
    ) {
      return res.status(400).json({
        message: "Cannot cancel order. Order has already been picked up.",
      });
    }

    // Handle payment refund if order was paid online
    let refundProcessed = false;
    if (
      order.payment &&
      order.paymentMethod !== "cod" &&
      order.stripePaymentId
    ) {
      try {
        // Check if payment intent exists and is succeeded
        const paymentIntent = await stripe.paymentIntents.retrieve(
          order.stripePaymentId,
        );

        if (paymentIntent.status === "succeeded") {
          // Create refund
          const refund = await stripe.refunds.create({
            payment_intent: order.stripePaymentId,
            amount: Math.round(order.totalAmount * 100), // Convert to cents
            reason: "requested_by_customer",
          });

          if (refund.status === "succeeded" || refund.status === "pending") {
            refundProcessed = true;
            console.log("✅ Refund processed for cancelled order:", {
              orderId: order._id,
              refundId: refund.id,
              amount: refund.amount / 100,
            });
          }
        }
      } catch (refundError) {
        console.error("❌ Refund error:", refundError);
        // Continue with cancellation even if refund fails
        // Admin can handle refund manually if needed
      }
    }

    // Update shop order status
    shopOrder.status = "cancelled";
    shopOrder.cancelReason = reason.trim();
    shopOrder.cancelledAt = new Date();

    await order.save();

    const io = req.app.get("io");
    const socketMap = req.app.get("socketMap");

    const shopIdForEmit =
      shopOrder.shop && shopOrder.shop._id
        ? shopOrder.shop._id.toString()
        : shopOrder.shop?.toString();

    // Notify customer about cancellation
    if (io && order.user?._id) {
      const userSocketId =
        socketMap?.get(userId) || order.user?.socketId || userId;

      io.to(userSocketId).emit("update-status", {
        orderId: order._id.toString(),
        readableOrderId: order.orderId || null,
        shopId: shopIdForEmit,
        shopOrderId: shopOrder._id.toString(),
        status: "cancelled",
        userId: userId,
        cancelReason: reason,
        refundProcessed: refundProcessed,
      });

      // Also emit to user room as backup
      io.to(userId).emit("update-status", {
        orderId: order._id.toString(),
        readableOrderId: order.orderId || null,
        shopId: shopIdForEmit,
        shopOrderId: shopOrder._id.toString(),
        status: "cancelled",
        userId: userId,
        cancelReason: reason,
        refundProcessed: refundProcessed,
      });

      createNotification({
        recipient: order.user._id,
        title: "Order Cancelled",
        message: `Your order ${order.orderId || `#${order._id}`} was cancelled. Reason: ${reason}${refundProcessed ? " Refund has been processed." : ""}`,
        type: "order_update",
        relatedId: order._id,
        relatedModel: "Order",
      });
    }

    // Notify owner about cancellation
    if (io && shopOrder.owner?._id) {
      const ownerSocketId =
        socketMap?.get(ownerId) || shopOrder.owner?.socketId || ownerId;

      io.to(ownerSocketId).emit("update-status", {
        orderId: order._id.toString(),
        readableOrderId: order.orderId || null,
        shopId: shopIdForEmit,
        shopOrderId: shopOrder._id.toString(),
        status: "cancelled",
        userId: userId,
        ownerId: ownerId,
        cancelReason: reason,
      });

      // Also emit to owner room as backup
      io.to(ownerId).emit("update-status", {
        orderId: order._id.toString(),
        readableOrderId: order.orderId || null,
        shopId: shopIdForEmit,
        shopOrderId: shopOrder._id.toString(),
        status: "cancelled",
        userId: userId,
        ownerId: ownerId,
        cancelReason: reason,
      });
    }

    // Notify assigned delivery boy (if any)
    if (shopOrder.assignedDeliveryBoy && assignedDeliveryBoyId) {
      const deliveryBoySocketId =
        socketMap?.get(assignedDeliveryBoyId) ||
        shopOrder.assignedDeliveryBoy?.socketId ||
        assignedDeliveryBoyId;

      createNotification({
        recipient: assignedDeliveryBoyId,
        title: "Order Canceled",
        message: `Order ${order.orderId || `#${order._id}`} was cancelled.`,
        type: "delivery_assignment",
        relatedId: order._id,
        relatedModel: "Order",
      });

      if (io) {
        io.to(deliveryBoySocketId).emit("delivery-order-cancelled", {
          orderId: order._id.toString(),
          orderCode: order.orderId || null,
          shopOrderId: shopOrder._id.toString(),
          reason,
        });

        // Also emit update-status to deliverer
        io.to(deliveryBoySocketId).emit("update-status", {
          orderId: order._id.toString(),
          readableOrderId: order.orderId || null,
          shopId: shopIdForEmit,
          shopOrderId: shopOrder._id.toString(),
          status: "cancelled",
        });

        // Also emit to deliverer room as backup
        io.to(assignedDeliveryBoyId).emit("update-status", {
          orderId: order._id.toString(),
          readableOrderId: order.orderId || null,
          shopId: shopIdForEmit,
          shopOrderId: shopOrder._id.toString(),
          status: "cancelled",
        });
      }
    }

    res.status(200).json({
      message: "Order cancelled successfully",
      refundProcessed: refundProcessed,
      order: {
        _id: order._id,
        shopOrder: {
          _id: shopOrder._id,
          status: shopOrder.status,
          cancelReason: shopOrder.cancelReason,
        },
      },
    });
  } catch (error) {
    console.error("Cancel order error:", error);
    res.status(500).json({ message: `Cancel order error: ${error.message}` });
  }
};

export const backfillMissingOrderIds = async (req, res) => {
  try {
    const missing = await Order.find({
      $or: [
        { orderId: { $exists: false } },
        { orderId: null },
        { orderId: "" },
      ],
    }).select("_id orderId");
    if (!missing || missing.length === 0) {
      return res.status(200).json({ totalMissing: 0, updated: 0, samples: [] });
    }

    const makeId = async () => {
      const rnd = Math.floor(100000 + Math.random() * 900000);
      const candidate = `LMF-${rnd}`;
      const exists = await Order.findOne({ orderId: candidate }).lean();
      if (exists) return makeId();
      return candidate;
    };

    const ops = [];
    for (const doc of missing) {
      const readable = await makeId();
      ops.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { orderId: readable } },
        },
      });
    }

    if (ops.length > 0) {
      await Order.bulkWrite(ops, { ordered: false });
    }

    const samples = await Order.find({
      _id: { $in: missing.map((m) => m._id) },
    })
      .select("_id orderId")
      .limit(10)
      .lean();

    return res
      .status(200)
      .json({ totalMissing: missing.length, updated: ops.length, samples });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `backfill orderId error ${error.message}` });
  }
};
