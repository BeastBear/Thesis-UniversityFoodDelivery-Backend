import mongoose from "mongoose";
import SystemSettings from "./models/systemSettings.model.js";

const MONGO_URL = process.env.MONGODB_URL;

const checkSettings = async () => {
  try {
    await mongoose.connect(MONGO_URL);
    console.log("DB Connected");

    const settings = await SystemSettings.find({});
    console.log(`Found ${settings.length} SystemSettings documents.`);

    settings.forEach((s, i) => {
      console.log(`Doc ${i} ID: ${s._id}`);
      console.log(
        `Doc ${i} Cafeterias:`,
        JSON.stringify(s.cafeteriaSettings, null, 2),
      );
    });

    mongoose.disconnect();
  } catch (error) {
    console.error(error);
  }
};

checkSettings();
