import express from "express";
import {
  getCurrentUser,
  updateUserLocation,
  createCreditTopUpSession,
  verifyCreditTopUp,
  updateDeliveryBoyBankAccount,
  withdrawToBankDeliveryBoy,
  requestPayoutFromWallet,
  getTransactions,
  addSavedAddress,
  updateSavedAddress,
  deleteSavedAddress,
  addSavedCard,
  deleteSavedCard,
  setDefaultCard,
  setDefaultPaymentMethod,
  updateUserProfile,
  savePushSubscription,
  sendTestNotification,
  getOwnerVerification,
  submitOwnerVerification,
} from "../controllers/user.controller.js";
import { upload } from "../middlewares/multer.js";
import isAuth from "../middlewares/isAuth.js";

const router = express.Router();

router.get("/current", isAuth, getCurrentUser);
router.put(
  "/update-profile",
  isAuth,
  upload.single("image"),
  updateUserProfile
);
router.post("/update-location", isAuth, updateUserLocation);
router.post("/create-credit-topup-session", isAuth, createCreditTopUpSession);
router.post("/verify-credit-topup", isAuth, verifyCreditTopUp);
router.post("/update-bank-account", isAuth, updateDeliveryBoyBankAccount);
router.post("/withdraw-to-bank", isAuth, withdrawToBankDeliveryBoy);
router.post("/request-payout", isAuth, requestPayoutFromWallet);
router.get("/transactions", isAuth, getTransactions);

// Address Routes
router.post("/add-address", isAuth, addSavedAddress);
router.put("/update-address/:addressId", isAuth, updateSavedAddress);
router.delete("/delete-address/:addressId", isAuth, deleteSavedAddress);

// Card Routes
router.post("/add-card", isAuth, addSavedCard);
router.put("/set-default-card/:cardId", isAuth, setDefaultCard);
router.put("/set-default-payment-method", isAuth, setDefaultPaymentMethod);
router.delete("/delete-card/:cardId", isAuth, deleteSavedCard);

// Push Notification Routes
router.post("/subscribe-push", isAuth, savePushSubscription);
router.post("/send-test-notification", isAuth, sendTestNotification);

// Owner Verification Routes
router.get("/owner-verification", isAuth, getOwnerVerification);
router.post(
  "/owner-verification",
  isAuth,
  upload.fields([
    { name: "restaurantPhoto", maxCount: 1 },
    { name: "commercialRegistration", maxCount: 1 },
    { name: "storefrontPhoto", maxCount: 1 },
    { name: "kitchenPhoto", maxCount: 1 },
    { name: "bookbankHeaderPhoto", maxCount: 1 },
  ]),
  submitOwnerVerification
);

export default router;
