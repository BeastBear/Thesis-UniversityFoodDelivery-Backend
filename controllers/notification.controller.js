import Notification from "../models/notification.model.js";

export const getNotifications = async (req, res) => {
  try {
    const userId = req.userId;
    const page = Number(req.query?.page || 1);
    const limit = Number(req.query?.limit || 20);

    const notifications = await Notification.find({ recipient: userId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const total = await Notification.countDocuments({ recipient: userId });
    const unreadCount = await Notification.countDocuments({
      recipient: userId,
      isRead: false,
    });

    res.status(200).json({
      notifications,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      unreadCount,
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const notification = await Notification.findOneAndUpdate(
      { _id: id, recipient: req.userId },
      { isRead: true },
      { new: true },
    );

    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }

    res.status(200).json(notification);
  } catch (error) {
    console.error("Error marking notification as read:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const markAllAsRead = async (req, res) => {
  try {
    const userId = req.userId;
    await Notification.updateMany(
      { recipient: userId, isRead: false },
      { isRead: true },
    );

    res.status(200).json({ message: "All notifications marked as read" });
  } catch (error) {
    console.error("Error marking all as read:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Helper function to create notification internally
export const createNotification = async ({
  recipient,
  title,
  message,
  type,
  relatedId,
  relatedModel,
}) => {
  try {
    const notification = new Notification({
      recipient,
      title,
      message,
      type,
      relatedId,
      relatedModel,
    });
    await notification.save();
    return notification;
  } catch (error) {
    console.error("Error creating notification:", error);
  }
};

// Controller method to handle POST requests
export const createNotificationController = async (req, res) => {
  try {
    const { recipient, title, message, type, relatedId, relatedModel } =
      req.body;

    // Validate required fields
    if (!recipient || !title || !message || !type) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const notification = await createNotification({
      recipient,
      title,
      message,
      type,
      relatedId,
      relatedModel,
    });

    // Emit socket event for real-time updates
    const io = req.app.get("io");
    const socketMap = req.app.get("socketMap");

    if (io && socketMap) {
      // Find recipient's socket ID
      const recipientSocketId = socketMap.get(recipient.toString());
      if (recipientSocketId) {
        io.to(recipientSocketId).emit("notification", notification);
        console.log(`Notification sent to user ${recipient} via socket`);
      }
    }

    res.status(201).json(notification);
  } catch (error) {
    console.error("Error creating notification:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
