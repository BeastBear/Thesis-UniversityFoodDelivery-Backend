import express from "express";
import { isAuth, isAdmin } from "../middlewares/isAuth.js";
import {
  acceptOrder,
  adminFixPayment,
  cancelShopOrder as cancelOrder,
  cancelJobAssignment,
  checkOrderPaymentStatus,
  createPaymentIntent,
  fixPaymentStatus,
  getCurrentOrder,
  getDeliveryBoyAssignment,
  getMyOrders,
  getOrderById,
  getOrderBySessionId,
  handleStripeWebhook,
  manualUpdatePayment,
  testUpdatePayment,
  autoUpdatePayment,
  updatePaymentBySessionId,
  testSessionUpdate,
  placeOrder,
  sendDeliveryOtp,
  updateOrderItems,
  updateOrderStatus,
  updateOrderWithPaymentIntent,
  verifyDeliveryOtp,
  confirmPickup,
  confirmArrivalAtCustomer,
  confirmDelivery,
  verifyPayment,
  getTodayDeliveries,
  getCancellationCount,
  backfillMissingOrderIds,
} from "../controllers/order.controller.js";

const orderRouter = express.Router();

orderRouter.post("/place-order", isAuth, placeOrder);
orderRouter.get("/my-orders", isAuth, getMyOrders);
orderRouter.get("/get-assignments", isAuth, getDeliveryBoyAssignment);
orderRouter.get("/get-current-order", isAuth, getCurrentOrder);
orderRouter.post("/send-delivery-otp", isAuth, sendDeliveryOtp);
orderRouter.post("/verify-delivery-otp", isAuth, verifyDeliveryOtp);
orderRouter.post("/confirm-pickup", isAuth, confirmPickup);
orderRouter.post("/confirm-arrival", isAuth, confirmArrivalAtCustomer);
orderRouter.post("/confirm-delivery", isAuth, confirmDelivery);
orderRouter.post("/update-status/:orderId/:shopId", isAuth, updateOrderStatus);
orderRouter.post(
  "/update-order-items/:orderId/:shopId",
  isAuth,
  updateOrderItems,
);
orderRouter.post("/cancel-order/:orderId/:shopId", isAuth, cancelOrder);
orderRouter.post("/cancel-job/:orderId/:shopId", isAuth, cancelJobAssignment);
orderRouter.get("/cancellation-count", isAuth, getCancellationCount);
orderRouter.get("/accept-order/:assignmentId", isAuth, acceptOrder);
orderRouter.get("/get-order-by-id/:orderId", isAuth, getOrderById);
orderRouter.get("/session/:sessionId", isAuth, getOrderBySessionId);
orderRouter.post("/manual-update-payment", isAuth, manualUpdatePayment);
orderRouter.post("/auto-update-payment", autoUpdatePayment); // No auth required
orderRouter.post("/update-payment-by-session", updatePaymentBySessionId); // No auth required
orderRouter.post("/test-session-update", testSessionUpdate); // Test endpoint
orderRouter.get("/test-update-payment", testUpdatePayment);

// Stripe payment routes
orderRouter.post("/create-payment-intent", isAuth, createPaymentIntent);
orderRouter.post("/verify-payment", isAuth, verifyPayment);
orderRouter.post("/stripe-webhook", handleStripeWebhook);
orderRouter.patch(
  "/update-payment-intent",
  isAuth,
  updateOrderWithPaymentIntent,
);
orderRouter.post("/fix-payment-status", isAuth, fixPaymentStatus);
orderRouter.get("/admin-fix-payment/:orderId", adminFixPayment);
orderRouter.get(
  "/check-payment-status/:orderId",
  isAuth,
  checkOrderPaymentStatus,
);
orderRouter.get("/get-today-deliveries", isAuth, getTodayDeliveries);
orderRouter.post(
  "/backfill-order-ids",
  isAuth,
  isAdmin,
  backfillMissingOrderIds,
);

export default orderRouter;
