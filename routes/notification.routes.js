import express from "express";
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  createNotificationController,
} from "../controllers/notification.controller.js";
import isAuth from "../middlewares/isAuth.js";

const router = express.Router();

router.get("/", isAuth, getNotifications);
router.post("/", isAuth, createNotificationController);
router.put("/:id/read", isAuth, markAsRead);
router.put("/read-all", isAuth, markAllAsRead);

export default router;
