import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import User from "./models/user.model.js";

async function testUpdate() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to DB");
    
    // The real user ID from the stripe metadata we saw
    const userId = "69cebf1a129575d6cda33335";
    
    // Check if user exists
    const existingUser = await User.findById(userId);
    console.log("User exists:", !!existingUser);
    
    if (existingUser) {
      console.log("Current credit:", existingUser.jobCredit);
      const testPaymentId = "pi_test_" + Date.now();
      const updatedUser = await User.findOneAndUpdate(
        { _id: userId, processedTopUps: { $ne: testPaymentId } },
        { 
          $inc: { jobCredit: 1 },
          $push: { processedTopUps: testPaymentId }
        },
        { new: true }
      );
      console.log("Updated credit:", updatedUser?.jobCredit);
    }
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

testUpdate();
