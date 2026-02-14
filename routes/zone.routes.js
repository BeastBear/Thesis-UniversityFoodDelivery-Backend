import express from "express";
import { isAuth, isAdmin } from "../middlewares/isAuth.js";
import {
  createZone,
  getZones,
  deleteZone,
} from "../controllers/zone.controller.js";

const router = express.Router();

router.post("/", isAuth, isAdmin, createZone);
router.get("/", isAuth, isAdmin, getZones); // Or public if needed
router.delete("/:zoneId", isAuth, isAdmin, deleteZone);

export default router;
