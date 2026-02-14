import express from "express";
import { isAuth, isAdmin } from "../middlewares/isAuth.js";
import {
  createTicket,
  getAllTickets,
  getUserTickets,
  getTicketById,
  addTicketMessage,
  updateTicketStatus,
} from "../controllers/ticket.controller.js";

const router = express.Router();

// User routes
router.post("/create", isAuth, createTicket);
router.get("/my-tickets", isAuth, getUserTickets);

// Admin routes
router.get("/all", isAuth, isAdmin, getAllTickets);
router.put("/:ticketId/update", isAuth, isAdmin, updateTicketStatus);

// Ticket detail + chat (user can access own ticket; admin can access any)
router.get("/:ticketId", isAuth, getTicketById);
router.post("/:ticketId/messages", isAuth, addTicketMessage);

export default router;
