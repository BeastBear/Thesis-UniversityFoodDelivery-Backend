import express from "express";
import isAuth from "../middlewares/isAuth.js";
import {
  getOptionTemplates,
  getOptionTemplate,
  createOptionTemplate,
  updateOptionTemplate,
  deleteOptionTemplate,
} from "../controllers/optionTemplate.controller.js";

const optionTemplateRouter = express.Router();

optionTemplateRouter.get("/", isAuth, getOptionTemplates);
optionTemplateRouter.get("/:templateId", isAuth, getOptionTemplate);
optionTemplateRouter.post("/", isAuth, createOptionTemplate);
optionTemplateRouter.put("/:templateId", isAuth, updateOptionTemplate);
optionTemplateRouter.delete("/:templateId", isAuth, deleteOptionTemplate);

export default optionTemplateRouter;

