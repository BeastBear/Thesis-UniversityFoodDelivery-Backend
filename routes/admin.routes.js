import express from "express";
import { isAuth, isAdmin } from "../middlewares/isAuth.js";
import { upload } from "../middlewares/multer.js";
import {
  uploadImage,
  getAdminStats,
  getAllUsers,
  getAllShops,
  approveShop,
  getAllOrders,
  adminUpdateOrderStatus,
  getSystemSettings,
  updateSystemSettings,
  getPendingVerifications,
  getPendingOwnerVerifications,
  verifyDeliveryBoy,
  verifyOwner,
  toggleUserSuspension,
  updateUserRole,
  toggleShopClosure,
  adminUpdateItem,
  adminReassignRider,
  getFinancialStats,
  processPayoutRequest,
  migrateVerifiedOwnersToShops,
} from "../controllers/admin.controller.js";

import {
  adminGetGlobalCategories,
  adminCreateGlobalCategory,
  adminUpdateGlobalCategory,
  adminDeleteGlobalCategory,
} from "../controllers/globalCategory.controller.js";

const router = express.Router();

router.post(
  "/upload-image",
  isAuth,
  isAdmin,
  upload.single("image"),
  uploadImage,
);

router.get("/stats", isAuth, isAdmin, getAdminStats);
router.get("/users", isAuth, isAdmin, getAllUsers);
router.put("/user/:userId/suspend", isAuth, isAdmin, toggleUserSuspension);
router.put("/user/:userId/role", isAuth, isAdmin, updateUserRole);

router.get("/shops", isAuth, isAdmin, getAllShops);
router.put("/shop/:shopId/approve", isAuth, isAdmin, approveShop);
router.put("/shop/:shopId/closure", isAuth, isAdmin, toggleShopClosure);
router.put("/item/:itemId", isAuth, isAdmin, adminUpdateItem);

router.get("/orders", isAuth, isAdmin, getAllOrders);
router.put(
  "/order/:orderId/status/:shopOrderId",
  isAuth,
  isAdmin,
  adminUpdateOrderStatus,
);
router.put(
  "/order/:orderId/reassign/:shopOrderId",
  isAuth,
  isAdmin,
  adminReassignRider,
);

router.get("/finance", isAuth, isAdmin, getFinancialStats);
router.put("/payout/:payoutId/process", isAuth, isAdmin, processPayoutRequest);

router.get("/settings", isAuth, isAdmin, getSystemSettings);
router.put("/settings", isAuth, isAdmin, updateSystemSettings);

router.get("/verifications", isAuth, isAdmin, getPendingVerifications);
router.put("/verify-delivery-boy/:userId", isAuth, isAdmin, verifyDeliveryBoy);

router.get(
  "/owner-verifications",
  isAuth,
  isAdmin,
  getPendingOwnerVerifications,
);
router.put("/verify-owner/:userId", isAuth, isAdmin, verifyOwner);

router.post(
  "/migrate-verified-owners-to-shops",
  isAuth,
  isAdmin,
  migrateVerifiedOwnersToShops,
);

router.get("/global-categories", isAuth, isAdmin, adminGetGlobalCategories);
router.post("/global-categories", isAuth, isAdmin, adminCreateGlobalCategory);
router.put(
  "/global-categories/:categoryId",
  isAuth,
  isAdmin,
  adminUpdateGlobalCategory,
);
router.delete(
  "/global-categories/:categoryId",
  isAuth,
  isAdmin,
  adminDeleteGlobalCategory,
);

export default router;
