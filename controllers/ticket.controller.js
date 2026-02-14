import Ticket from "../models/ticket.model.js";
import TicketSubject from "../models/ticketSubject.model.js";
import User from "../models/user.model.js";
import { createNotification } from "./notification.controller.js";

// Create a new ticket (User)
export const createTicket = async (req, res) => {
  try {
    const { subjectId, subject, description, category, priority } = req.body;

    let resolvedSubject = subject;
    let resolvedCategory = category || "Other";
    let resolvedPriority = priority || "Medium";

    if (subjectId) {
      const mapping = await TicketSubject.findOne({
        _id: subjectId,
        isActive: true,
      });
      if (!mapping) {
        return res.status(400).json({ message: "Invalid subject" });
      }
      resolvedSubject = mapping.subject;
      resolvedCategory = mapping.category;
      resolvedPriority = mapping.priority;
    }

    if (!resolvedSubject || !description) {
      return res
        .status(400)
        .json({ message: "Subject and description are required" });
    }

    const requestingUser = await User.findById(req.userId).select("role");
    const senderRole = requestingUser?.role === "admin" ? "ADMIN" : "PARTNER";

    const newTicket = new Ticket({
      user: req.userId,
      subject: resolvedSubject,
      description,
      messages: [
        {
          senderId: req.userId,
          senderRole,
          message: description,
          createdAt: new Date(),
        },
      ],
      category: resolvedCategory,
      priority: resolvedPriority,
    });

    await newTicket.save();

    try {
      const io = req.app.get("io");
      const admins = await User.find({ role: "admin" }).select("_id");
      if (Array.isArray(admins) && admins.length > 0) {
        await Promise.all(
          admins.map((a) =>
            createNotification({
              recipient: a._id,
              title: "New Ticket",
              message: `${newTicket.subject}`,
              type: "ticket",
              relatedId: newTicket._id,
              relatedModel: "Ticket",
            }),
          ),
        );
      }
      if (io) {
        io.to("admins").emit("notification", {
          type: "ticket",
          ticketId: newTicket._id.toString(),
        });
      }
    } catch (e) {
      // ignore
    }

    res
      .status(201)
      .json({ message: "Ticket created successfully", ticket: newTicket });
  } catch (error) {
    res.status(500).json({ message: `Create ticket error: ${error.message}` });
  }
};

export const getTicketById = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const user = await User.findById(req.userId).select("role");
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    const ticket = await Ticket.findById(ticketId)
      .populate("user", "fullName email mobile role")
      .populate("resolvedBy", "fullName")
      .populate("messages.senderId", "fullName role profileImage email")
      .sort({ "messages.createdAt": 1 });

    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    const ticketUserId =
      typeof ticket.user === "object" && ticket.user?._id
        ? ticket.user._id.toString()
        : ticket.user?.toString();

    if (user.role !== "admin" && ticketUserId !== req.userId) {
      return res.status(403).json({ message: "Access denied" });
    }

    return res.status(200).json(ticket);
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Get ticket error: ${error.message}` });
  }
};

export const addTicketMessage = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { message } = req.body;

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ message: "Message is required" });
    }

    const user = await User.findById(req.userId).select("role");
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    if (ticket.status === "Resolved" || ticket.status === "Closed") {
      return res
        .status(400)
        .json({ message: "This ticket is resolved and cannot be replied to" });
    }

    if (user.role !== "admin" && ticket.user?.toString() !== req.userId) {
      return res.status(403).json({ message: "Access denied" });
    }

    const senderRole = user.role === "admin" ? "ADMIN" : "PARTNER";
    ticket.messages.push({
      senderId: req.userId,
      senderRole,
      message: message.trim(),
      createdAt: new Date(),
    });

    await ticket.save();

    const populated = await Ticket.findById(ticketId)
      .populate("user", "fullName email mobile role")
      .populate("resolvedBy", "fullName")
      .populate("messages.senderId", "fullName role profileImage email");

    return res.status(200).json({ message: "Message sent", ticket: populated });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `Add message error: ${error.message}` });
  }
};

// Get all tickets (Admin)
export const getAllTickets = async (req, res) => {
  try {
    const tickets = await Ticket.find()
      .populate("user", "fullName email mobile")
      .populate("resolvedBy", "fullName")
      .sort({ createdAt: -1 });
    res.status(200).json(tickets);
  } catch (error) {
    res.status(500).json({ message: `Get tickets error: ${error.message}` });
  }
};

// Get user's tickets (User)
export const getUserTickets = async (req, res) => {
  try {
    const tickets = await Ticket.find({ user: req.userId }).sort({
      createdAt: -1,
    });
    res.status(200).json(tickets);
  } catch (error) {
    res
      .status(500)
      .json({ message: `Get user tickets error: ${error.message}` });
  }
};

// Update ticket status/response (Admin)
export const updateTicketStatus = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { status, adminResponse } = req.body;

    const updateData = { status };
    if (adminResponse) updateData.adminResponse = adminResponse;

    if (status === "Resolved" || status === "Closed") {
      updateData.resolvedBy = req.userId;
      updateData.resolvedAt = new Date();
    }

    const ticket = await Ticket.findByIdAndUpdate(ticketId, updateData, {
      new: true,
    });

    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    res.status(200).json({ message: "Ticket updated successfully", ticket });
  } catch (error) {
    res.status(500).json({ message: `Update ticket error: ${error.message}` });
  }
};
