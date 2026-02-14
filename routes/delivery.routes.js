import express from "express";
import { isAuth } from "../middlewares/isAuth.js";
import { upload } from "../middlewares/multer.js";
import {
  uploadVerificationDocs,
  getVerificationStatus,
  updateDelivererStatus,
  getFinancialSummary,
} from "../controllers/delivery.controller.js";

const router = express.Router();

router.post(
  "/verify",
  isAuth,
  upload.fields([{ name: "studentCard", maxCount: 1 }]),
  uploadVerificationDocs,
);

router.get("/status", isAuth, getVerificationStatus);
router.patch("/status", isAuth, updateDelivererStatus);
router.get("/financial-summary", isAuth, getFinancialSummary);

export default router;
