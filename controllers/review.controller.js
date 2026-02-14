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
  try {
    const userId = req.userId;
    const { riderReview, shopReview, shopOrderId } = req.body;

    console.log("Review submission data:", {
      userId,
      riderReview,
      shopReview,
      shopOrderId,
      riderId: riderReview?.riderId,
      userReviewing: userId,
    });

    // 1. Save Rider Review
    let riderReviewCreated = false;
    if (riderReview && riderReview.riderId) {
      // Check if already exists to prevent duplicates
      const existingRiderReview = await RiderReview.findOne({
        shopOrder: shopOrderId,
        user: userId,
        rider: riderReview.riderId,
      });

      console.log("Existing rider review check:", {
        shopOrderId,
        userId,
        riderId: riderReview.riderId,
        found: !!existingRiderReview,
        existingReview: existingRiderReview,
        reviewDetails: existingRiderReview
          ? {
              rating: existingRiderReview.rating,
              createdAt: existingRiderReview.createdAt,
              comment: existingRiderReview.comment,
            }
          : null,
      });

      if (!existingRiderReview) {
        const newRiderReview = await RiderReview.create({
          rider: riderReview.riderId,
          user: userId,
          shopOrder: shopOrderId,
          rating: riderReview.rating,
          tags: riderReview.tags,
          comment: riderReview.comment,
          tipAmount: riderReview.tipAmount,
        });
        console.log("Created new rider review:", newRiderReview);
        riderReviewCreated = true;
      } else {
        console.log("Rider review already exists, skipping creation");

        // Check total review count for this rider to verify it's being counted
        const totalRiderReviews = await RiderReview.find({
          rider: riderReview.riderId,
        });
        console.log("Total reviews for this rider:", {
          riderId: riderReview.riderId,
          totalReviews: totalRiderReviews.length,
          recentReviews: totalRiderReviews.slice(-3).map((r) => ({
            rating: r.rating,
            createdAt: r.createdAt,
            user: r.user,
            shopOrder: r.shopOrder,
          })),
        });
      }

      // 2. Save Shop Review
      if (shopReview && shopReview.shopId) {
        const { rating, shopId, comment } = shopReview;

        await Review.findOneAndUpdate(
          { shop: shopId, user: userId, shopOrder: shopOrderId },
          {
            rating,
            comment: comment || "",
          },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );

        // Recalculate shop rating
        const reviews = await Review.find({ shop: shopId });
        const totalRating = reviews.reduce((sum, r) => sum + r.rating, 0);
        const averageRating =
          reviews.length > 0 ? totalRating / reviews.length : 0;

        await Shop.findByIdAndUpdate(shopId, {
          "rating.average": Math.round(averageRating * 10) / 10,
          "rating.count": reviews.length,
        });
      }
    }

    // Determine what was actually submitted
    const riderReviewSubmitted = riderReviewCreated;
    const shopReviewSubmitted = !!(shopReview && shopReview.shopId);

    return res.status(200).json({
      message: "Reviews submitted successfully",
      riderReviewSubmitted,
      shopReviewSubmitted,
      riderReviewAlreadyExisted:
        !!(riderReview && riderReview.riderId) && !riderReviewCreated,
    });
  } catch (error) {
    console.error("Submit review error:", error);
    return res
      .status(500)
      .json({ message: `Submit review error: ${error.message}` });
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
