import mongoose from "mongoose";
import Review from "../models/review.model.js";
import Shop from "../models/shop.model.js";
import RiderReview from "../models/riderReview.model.js";

// Create or update a review
export const createReview = async (req, res) => {
  try {
    const { shopId } = req.params;
    const { rating, comment } = req.body;
    const userId = req.userId;

    // Validate rating
    if (!rating || rating < 1 || rating > 5) {
      return res
        .status(400)
        .json({ message: "Rating must be between 1 and 5" });
    }

    // Check if shop exists
    const shop = await Shop.findById(shopId);
    if (!shop) {
      return res.status(404).json({ message: "Shop not found" });
    }

    // Upsert logic: Update if exists, Insert if new
    // Check if a review from this UserID for this ShopID already exists
    // For general reviews (not tied to a specific order), we check for shopOrder: null
    const review = await Review.findOneAndUpdate(
      { shop: shopId, user: userId, shopOrder: null },
      {
        shop: shopId,
        user: userId,
        rating,
        comment: comment || "",
        shopOrder: null,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    // Calculate and update shop rating
    const reviews = await Review.find({ shop: shopId });
    const totalRating = reviews.reduce((sum, r) => sum + r.rating, 0);
    const averageRating = reviews.length > 0 ? totalRating / reviews.length : 0;

    await Shop.findByIdAndUpdate(shopId, {
      "rating.average": Math.round(averageRating * 10) / 10, // Round to 1 decimal
      "rating.count": reviews.length,
    });

    await review.populate("user", "fullName");
    return res.status(201).json(review);
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Create review error: ${error.message}` });
  }
};

// Get reviews for a shop
export const getShopReviews = async (req, res) => {
  try {
    const { shopId } = req.params;

    const reviews = await Review.find({ shop: shopId })
      .populate("user", "fullName profileImage")
      .sort({ createdAt: -1 });

    return res.status(200).json(reviews);
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Get reviews error: ${error.message}` });
  }
};

// Get user's review for a shop
export const getUserReview = async (req, res) => {
  try {
    const { shopId } = req.params;
    const userId = req.userId;

    const review = await Review.findOne({
      shop: shopId,
      user: userId,
    }).populate("user", "fullName profileImage");

    return res.status(200).json(review || null);
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Get user review error: ${error.message}` });
  }
};

// Delete a review
export const deleteReview = async (req, res) => {
  try {
    const { reviewId } = req.params;
    const userId = req.userId;

    const review = await Review.findById(reviewId);
    if (!review) {
      return res.status(404).json({ message: "Review not found" });
    }

    // Check if user owns the review
    if (review.user.toString() !== userId) {
      return res
        .status(403)
        .json({ message: "Not authorized to delete this review" });
    }

    const shopId = review.shop;
    await Review.findByIdAndDelete(reviewId);

    // Recalculate shop rating
    const reviews = await Review.find({ shop: shopId });
    const totalRating = reviews.reduce((sum, r) => sum + r.rating, 0);
    const averageRating = reviews.length > 0 ? totalRating / reviews.length : 0;

    await Shop.findByIdAndUpdate(shopId, {
      "rating.average": Math.round(averageRating * 10) / 10,
      "rating.count": reviews.length,
    });

    return res.status(200).json({ message: "Review deleted successfully" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Delete review error: ${error.message}` });
  }
};

// Update an existing review
export const updateReview = async (req, res) => {
  try {
    const { reviewId } = req.params;
    const userId = req.userId;
    const { rating, comment } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res
        .status(400)
        .json({ message: "Rating must be between 1 and 5" });
    }

    const review = await Review.findById(reviewId);
    if (!review) {
      return res.status(404).json({ message: "Review not found" });
    }

    if (review.user.toString() !== userId) {
      return res
        .status(403)
        .json({ message: "Not authorized to update this review" });
    }

    review.rating = rating;
    review.comment = comment || "";
    review.updatedAt = new Date();
    await review.save();

    // Recalculate shop rating
    const shopId = review.shop;
    const reviews = await Review.find({ shop: shopId });
    const totalRating = reviews.reduce((sum, r) => sum + r.rating, 0);
    const averageRating = reviews.length > 0 ? totalRating / reviews.length : 0;

    await Shop.findByIdAndUpdate(shopId, {
      "rating.average": Math.round(averageRating * 10) / 10,
      "rating.count": reviews.length,
    });

    await review.populate("user", "fullName");
    return res.status(200).json(review);
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Update review error: ${error.message}` });
  }
};

// Submit combined delivery review (Rider + Shop)
export const submitDeliveryReview = async (req, res) => {
  console.log("🚀 [DEBUG] Starting submitDeliveryReview", {
    body: JSON.stringify(req.body),
    userId: req.userId,
  });

  const userId = req.userId;
  const { riderReview, delivererReview, shopReview, shopOrderId } = req.body;

  // 1. Meta-Extraction
  const activeRiderReview = riderReview || delivererReview;
  const activeRiderIdStr = activeRiderReview?.riderId || activeRiderReview?.delivererId;
  
  let riderReviewCreated = false;
  let riderReviewAlreadyExisted = false;
  let shopReviewSubmitted = false;

  try {
    // 2. Rider Review Logic (Isolated)
    if (activeRiderReview) {
      try {
        console.log("🔍 [DEBUG] Processing Rider Review...");
        if (!activeRiderIdStr || !mongoose.Types.ObjectId.isValid(String(activeRiderIdStr))) {
          throw new Error(`Invalid riderId: ${activeRiderIdStr}`);
        }
        if (!shopOrderId || !mongoose.Types.ObjectId.isValid(String(shopOrderId))) {
          throw new Error(`Invalid shopOrderId for rider: ${shopOrderId}`);
        }

        const riderId = new mongoose.Types.ObjectId(String(activeRiderIdStr));
        const sOrderId = new mongoose.Types.ObjectId(String(shopOrderId));
        const uId = new mongoose.Types.ObjectId(String(userId));

        // Check for existing
        const existing = await RiderReview.findOne({
          shopOrder: sOrderId,
          user: uId,
          rider: riderId,
        });

        if (!existing) {
          await RiderReview.create({
            rider: riderId,
            user: uId,
            shopOrder: sOrderId,
            rating: Number(activeRiderReview.rating) || 5,
            tags: activeRiderReview.tags || [],
            comment: activeRiderReview.comment || "",
            tipAmount: Number(activeRiderReview.tipAmount) || 0,
          });
          riderReviewCreated = true;
          console.log("✅ [DEBUG] Rider Review Created");
        } else {
          riderReviewAlreadyExisted = true;
          console.log("ℹ️ [DEBUG] Rider Review Exists");
        }
      } catch (riderErr) {
        console.error("❌ [DEBUG] Rider Review sub-error:", riderErr.message);
        // We don't throw here to allow Shop Review to proceed if possible
      }
    }

    // 3. Shop Review Logic (Isolated)
    if (shopReview && shopReview.shopId) {
      try {
        console.log("🔄 [DEBUG] Processing Shop Review...");
        const { rating, shopId: shopIdStr, comment } = shopReview;

        if (!mongoose.Types.ObjectId.isValid(String(shopIdStr))) {
          throw new Error(`Invalid shopId: ${shopIdStr}`);
        }

        const shopId = new mongoose.Types.ObjectId(String(shopIdStr));
        const sOrderId = shopOrderId && mongoose.Types.ObjectId.isValid(String(shopOrderId)) 
          ? new mongoose.Types.ObjectId(String(shopOrderId)) 
          : null;
        const uId = new mongoose.Types.ObjectId(String(userId));

        await Review.findOneAndUpdate(
          { shop: shopId, user: uId, shopOrder: sOrderId },
          {
            rating: Number(rating) || 5,
            comment: comment || "",
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        shopReviewSubmitted = true;

        // Async rating update (non-blocking for response speed)
        Review.find({ shop: shopId }).then(reviews => {
          const totalRating = reviews.reduce((sum, r) => sum + r.rating, 0);
          const avg = reviews.length > 0 ? totalRating / reviews.length : 0;
          Shop.findByIdAndUpdate(shopId, {
            "rating.average": Math.round(avg * 10) / 10,
            "rating.count": reviews.length,
          }).catch(e => console.error("Error updating shop rating:", e.message));
        });

        console.log("✅ [DEBUG] Shop Review Processed");
      } catch (shopErr) {
        console.error("❌ [DEBUG] Shop Review sub-error:", shopErr.message);
      }
    }

    return res.status(200).json({
      message: "Reviews processed",
      riderReviewSubmitted: riderReviewCreated,
      delivererReviewSubmitted: riderReviewCreated,
      shopReviewSubmitted,
      riderReviewAlreadyExisted,
      delivererReviewAlreadyExisted,
    });

  } catch (globalErr) {
    console.error("❌ [DEBUG] Critical Global Review Error:", globalErr);
    return res.status(500).json({
      message: "Global submit review error",
      details: globalErr.message,
    });
  }
};

// Get reviews for a rider
export const getRiderReviews = async (req, res) => {
  try {
    const riderId = req.userId; // Assuming the logged-in user is the rider

    const reviews = await RiderReview.find({ rider: riderId })
      .populate("user", "fullName profileImage")
      .populate({
        path: "shopOrder",
        select: "shopOrderItems shop",
        populate: { path: "shop", select: "name image" },
      })
      .sort({ createdAt: -1 });

    return res.status(200).json(reviews);
  } catch (error) {
    return res.status(500).json({
      message: `Get rider reviews error: ${error.message}`,
    });
  }
};
