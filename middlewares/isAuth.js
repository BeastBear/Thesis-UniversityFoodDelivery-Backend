import jwt from "jsonwebtoken";
import User from "../models/user.model.js";

export const isAuth = async (req, res, next) => {
  try {
    const token = req.cookies?.token;
    if (!token) return res.status(401).json({ message: "token not found" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded?.userId)
      return res.status(401).json({ message: "invalid token" });

    // Check if user is suspended
    const user = await User.findById(decoded.userId);
    if (!user) return res.status(401).json({ message: "User not found" });
    if (user.isSuspended) {
      res.clearCookie("token");
      return res
        .status(403)
        .json({ message: "Account suspended. Contact support." });
    }

    req.userId = decoded.userId;
    next();
  } catch (error) {
    console.error("isAuth error:", error.message);
    // Clear any invalid cookies
    res.clearCookie("token");
    return res
      .status(401)
      .json({ message: `invalid or expired token: ${error.message}` });
  }
};

export const isAdmin = async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ message: "Access denied. Admin only." });
    }
    next();
  } catch (error) {
    res.status(500).json({ message: `Admin check error: ${error.message}` });
  }
};

export default isAuth;
