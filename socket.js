import User from "./models/user.model.js";

const socketHandler = (io, app) => {
  io.on("connection", (socket) => {
    socket.on("identity", async ({ userId }) => {
      try {
        const updatedUser = await User.findByIdAndUpdate(
          userId,
          { socketId: socket.id, isOnline: true },
          { new: true, select: "role" },
        );

        const socketMap = app.get("socketMap");
        if (socketMap) {
          socketMap.set(userId.toString(), socket.id);
        }

        // Join a room with the user's ID to allow broadcasting to all of user's devices/tabs
        socket.join(userId.toString());

        if (updatedUser?.role === "deliveryBoy") {
          socket.join("deliveryBoys");
        }

        if (updatedUser?.role === "admin") {
          socket.join("admins");
        }
      } catch (error) {
        console.log(error);
      }
    });

    socket.on("disconnect", async () => {
      try {
        const user = await User.findOneAndUpdate(
          { socketId: socket.id },
          { socketId: null, isOnline: false },
          { new: true, select: "role" },
        );

        const socketMap = app.get("socketMap");
        if (socketMap && user?._id) {
          socketMap.delete(user._id.toString());
        }

        if (user?.role === "deliveryBoy") {
          socket.leave("deliveryBoys");
        }

        if (user?.role === "admin") {
          socket.leave("admins");
        }
      } catch (error) {
        console.log(error);
      }
    });

    socket.on("join_order_room", ({ orderId }) => {
      if (!orderId) return;
      socket.join(orderId.toString());
    });

    socket.on("leave_order_room", ({ orderId }) => {
      if (!orderId) return;
      socket.leave(orderId.toString());
    });
  });
};

export default socketHandler;
