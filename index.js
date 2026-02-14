import express from "express";
import dotenv from "dotenv";
dotenv.config();
import connectDb from "./config/db.js";
import cookieParser from "cookie-parser";
import authRouter from "./routes/auth.routes.js";
import cors from "cors";
import userRouter from "./routes/user.routes.js";
import shopRouter from "./routes/shop.routes.js";
import itemRouter from "./routes/item.routes.js";
import orderRouter from "./routes/order.routes.js";
import reviewRouter from "./routes/review.routes.js";
import categoryRouter from "./routes/category.routes.js";
import globalCategoryRouter from "./routes/globalCategory.routes.js";
import optionTemplateRouter from "./routes/optionTemplate.routes.js";
import notificationRouter from "./routes/notification.routes.js";
import adminRouter from "./routes/admin.routes.js";
import ticketRouter from "./routes/ticket.routes.js";
import ticketSubjectRouter from "./routes/ticketSubject.routes.js";
import deliveryRouter from "./routes/delivery.routes.js";
import zoneRouter from "./routes/zone.routes.js";
import settingsRouter from "./routes/settings.routes.js";
import http from "http";
import { Server } from "socket.io";
import socketHandler from "./socket.js";
import path from "path";
import { fileURLToPath } from "url";
import logger, { requestLogger } from "./config/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true,
    methods: ["POST", "GET"],
  },
});

app.set("io", io);
app.set("socketMap", new Map());
const port = process.env.PORT || 5000;
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true,
  }),
);

// Serve static files from public directory
app.use("/public", express.static(path.join(__dirname, "public")));

// Stripe webhook must be before express.json() middleware
app.use("/api/order/stripe-webhook", express.raw({ type: "application/json" }));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

// Add request logging middleware
app.use(requestLogger);
app.use("/api/auth", authRouter);
app.use("/api/user", userRouter);
app.use("/api/shop", shopRouter);
app.use("/api/item", itemRouter);
app.use("/api/order", orderRouter);
app.use("/api/review", reviewRouter);
app.use("/api/category", categoryRouter);
app.use("/api/global-categories", globalCategoryRouter);
app.use("/api/option-template", optionTemplateRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/admin", adminRouter);
app.use("/api/tickets", ticketRouter);
app.use("/api/ticket-subjects", ticketSubjectRouter);
app.use("/api/delivery", deliveryRouter);
app.use("/api/zone", zoneRouter);
app.use("/api/settings", settingsRouter);
socketHandler(io, app);
server.listen(port, () => {
  connectDb();
  logger.info(`Server started on port ${port}`);
  logger.info(`Environment: ${process.env.NODE_ENV || "development"}`);
});
