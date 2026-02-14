import express from "express";
import { getPublicGlobalCategories } from "../controllers/globalCategory.controller.js";

const router = express.Router();

router.get("/", getPublicGlobalCategories);

export default router;
