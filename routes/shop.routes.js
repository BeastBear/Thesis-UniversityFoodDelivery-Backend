import express from "express";
import {
  createEditShop,
  getMyShop,
  getShopByCity,
  getAllShops,
  getShopById,
  temporaryClose,
  closeToday,
  closeMultipleDays,
  addSpecialHoliday,
  removeSpecialHoliday,
  updateEPaymentAccount,
  withdrawToBank,
  requestPayoutFromWallet,
  getTransactions,
} from "../controllers/shop.controller.js";
import isAuth from "../middlewares/isAuth.js";
import { upload } from "../middlewares/multer.js";

const shopRouter = express.Router();

shopRouter.post("/create-edit", isAuth, upload.single("image"), createEditShop);
shopRouter.get("/get-my", isAuth, getMyShop);
shopRouter.get("/get-by-city/:city", isAuth, getShopByCity);
shopRouter.get("/get-all-shops", isAuth, getAllShops);
shopRouter.get("/get-by-id/:shopId", isAuth, getShopById);
shopRouter.post("/temporary-close", isAuth, temporaryClose);
shopRouter.post("/close-today", isAuth, closeToday);
shopRouter.post("/close-multiple-days", isAuth, closeMultipleDays);
shopRouter.post("/add-special-holiday", isAuth, addSpecialHoliday);
shopRouter.post("/remove-special-holiday", isAuth, removeSpecialHoliday);
shopRouter.post("/update-e-payment-account", isAuth, updateEPaymentAccount);
shopRouter.post("/withdraw-to-bank", isAuth, withdrawToBank);
shopRouter.post("/request-payout", isAuth, requestPayoutFromWallet);
shopRouter.get("/transactions", isAuth, getTransactions);

export default shopRouter;
