import express from "express";
import isAuth from "../middlewares/isAuth.js";
import {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,
} from "../controllers/category.controller.js";

const categoryRouter = express.Router();

categoryRouter.get("/", isAuth, getCategories);
categoryRouter.post("/", isAuth, createCategory);
categoryRouter.put("/:categoryId", isAuth, updateCategory);
categoryRouter.delete("/:categoryId", isAuth, deleteCategory);
categoryRouter.post("/reorder", isAuth, reorderCategories);

export default categoryRouter;

