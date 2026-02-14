import express from "express";
import {
  createReview,
  getShopReviews,
  getUserReview,
  deleteReview,
  updateReview,
  submitDeliveryReview,
  getRiderReviews,
} from "../controllers/review.controller.js";
import isAuth from "../middlewares/isAuth.js";

const reviewRouter = express.Router();

reviewRouter.post("/delivery-completed", isAuth, submitDeliveryReview);
reviewRouter.get("/rider/my-reviews", isAuth, getRiderReviews);
reviewRouter.post("/shop/:shopId", isAuth, createReview);
reviewRouter.get("/shop/:shopId", getShopReviews);
reviewRouter.get("/shop/:shopId/user", isAuth, getUserReview);
reviewRouter.put("/:reviewId", isAuth, updateReview);
reviewRouter.delete("/:reviewId", isAuth, deleteReview);

export default reviewRouter;
