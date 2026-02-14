import express from "express";
import { isAuth, isAdmin } from "../middlewares/isAuth.js";
import {
  listActiveTicketSubjects,
  adminListTicketSubjects,
  adminCreateTicketSubject,
  adminUpdateTicketSubject,
  adminDeleteTicketSubject,
} from "../controllers/ticketSubject.controller.js";

const router = express.Router();

router.get("/", isAuth, listActiveTicketSubjects);

router.get("/admin", isAuth, isAdmin, adminListTicketSubjects);
router.post("/admin", isAuth, isAdmin, adminCreateTicketSubject);
router.put("/admin/:subjectId", isAuth, isAdmin, adminUpdateTicketSubject);
router.delete("/admin/:subjectId", isAuth, isAdmin, adminDeleteTicketSubject);

export default router;
