import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

const genToken = async (userId) => {
  try {
    const token = jwt.sign({ userId }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });
    return token;
  } catch (error) {}
};

export default genToken;
