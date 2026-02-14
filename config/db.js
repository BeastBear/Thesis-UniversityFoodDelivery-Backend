import mongoose from "mongoose";
import logger from "./logger.js";

const connectDb = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URL);
    logger.info("Database connected successfully");
  } catch (error) {
    logger.error("Database connection failed", { error: error.message });
    process.exit(1);
  }
};

export default connectDb;
